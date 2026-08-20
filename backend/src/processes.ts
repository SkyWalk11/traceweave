import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProject } from "./store.js";
import { broadcast } from "./ws.js";
import type { ProcessStatus } from "./types.js";

const PORT = process.env.PORT || 4000;
const MAX_LOG_LINES = 500;

// The Node capture SDK, as a sibling package in this repo. All three are
// injected into every spawned project's NODE_OPTIONS — harmless no-ops for
// anything that isn't `node`, and they don't conflict with each other:
//  - auto.js: zero-edit HTTP-boundary capture (method/url/status per request)
//  - instrument.js: zero-edit, non-blocking, comprehensive per-function
//    capture (file/function/params for every call) — the main capture path
//  - debug-agent.js: opens a V8 Inspector session so the UI's clickable
//    gutter breakpoints *can* work, for whoever wants that instead/as well
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTO_CAPTURE_PATH =
  process.env.TTD_AUTO_JS_PATH ?? path.resolve(__dirname, "../../sdk/node/dist/auto.js");
const INSTRUMENT_PATH =
  process.env.TTD_INSTRUMENT_JS_PATH ?? path.resolve(__dirname, "../../sdk/node/dist/instrument.js");
const DEBUG_AGENT_PATH =
  process.env.TTD_DEBUG_AGENT_JS_PATH ?? path.resolve(__dirname, "../../sdk/node/dist/debug-agent.js");

// PHP capture SDK: zero-edit, comprehensive per-function capture via a
// stream-wrapper AST transform, delivered the same way Node's is (an
// automatic injection into the run command), just via a CLI flag instead of
// an env var since PHP has no NODE_OPTIONS equivalent.
const PHP_PREPEND_PATH =
  process.env.TTD_PHP_PREPEND_PATH ?? path.resolve(__dirname, "../../sdk/php/prepend.php");

// Matches the `php` token as the first word of the command (allowing a
// leading path like `/usr/bin/php`), so `php artisan serve` and
// `php artisan octane:frankenphp ...` both qualify without misfiring on an
// unrelated command that merely mentions "php" somewhere.
function isPhpCommand(cmd: string): boolean {
  return /^\S*\bphp\d*\b/.test(cmd.trim());
}

// `php artisan serve` re-execs into a brand-new php process that Laravel's
// ServeCommand builds itself — `[php_binary, '-S', 'host:port', server.php]`
// (see vendor/laravel/framework/.../ServeCommand.php:serverCommand()) — with
// no `-d` flags carried over from the outer invocation at all. Confirmed for
// real: the outer `artisan` process's own bootstrap got captured once (its
// framework init, not a request), but every actual HTTP request — handled
// entirely by that re-exec'd child — was never instrumented. Bypassing the
// re-exec by calling the same built-in server directly, with our flag on
// this one, is the only way to reach real request handling for this command.
function isArtisanServe(cmd: string): boolean {
  return /^\S*\bphp\d*\b\s+artisan\s+serve\b/.test(cmd.trim());
}

function rewriteArtisanServe(cmd: string, projectDir: string): string {
  const hostMatch = cmd.match(/--host=(\S+)/);
  const portMatch = cmd.match(/--port=(\S+)/);
  const host = hostMatch?.[1] ?? "127.0.0.1";
  const port = portMatch?.[1] ?? "8000";
  const serverScript = path.join(
    projectDir,
    "vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"
  );
  const phpBinary = cmd.trim().match(/^\S*\bphp\d*\b/)![0];
  // server.php resolves the front controller (index.php) relative to the
  // process's cwd, not its own location — the real ServeCommand runs it
  // with public/ as the working directory (`new Process(..., public_path(),
  // ...)`); reproduced the "Failed opening required '<projectDir>/index.php'"
  // fatal for real by skipping this the first time.
  return `cd ${path.join(projectDir, "public")} && ${phpBinary} -d auto_prepend_file=${PHP_PREPEND_PATH} -S ${host}:${port} ${serverScript}`;
}

function injectPhpCapture(cmd: string): string {
  return cmd.replace(/^(\S*\bphp\d*\b)/, `$1 -d auto_prepend_file=${PHP_PREPEND_PATH}`);
}

interface RunningProcess {
  child: ChildProcess;
  status: ProcessStatus;
  logs: string[];
}

const running = new Map<string, RunningProcess>();

// The `running` map only survives for this backend process's lifetime — a
// dev-mode restart (which happened repeatedly while building this) wipes it
// while the actual spawned process tree (detached, its own process group)
// keeps running, orphaned, holding whatever port it bound. Persisting each
// project's group pid to disk lets the *next* backend instance find and
// reap it before starting a fresh one, instead of accumulating one orphan
// per restart (observed for real: three leftover `php artisan serve` trees
// pushed CORE from port 8000 to 8003, since Laravel's dev server just tries
// the next free port when its preferred one is already taken).
const PIDFILE_DIR = path.join(os.tmpdir(), "ttd-pids");
fs.mkdirSync(PIDFILE_DIR, { recursive: true });

function pidfilePath(id: string): string {
  return path.join(PIDFILE_DIR, `${id}.pid`);
}

function reapLeftoverGroup(id: string): void {
  const file = pidfilePath(id);
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8").trim();
  fs.rmSync(file, { force: true });
  const pgid = Number(raw);
  if (!pgid) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    // already gone — nothing to reap
  }
}

function reapAllLeftovers(): void {
  for (const file of fs.readdirSync(PIDFILE_DIR)) {
    if (!file.endsWith(".pid")) continue;
    reapLeftoverGroup(path.basename(file, ".pid"));
  }
}
reapAllLeftovers();

function pushLog(id: string, rp: RunningProcess, chunk: Buffer) {
  const lines = chunk.toString("utf8").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return;
  rp.logs.push(...lines);
  if (rp.logs.length > MAX_LOG_LINES) rp.logs.splice(0, rp.logs.length - MAX_LOG_LINES);
  broadcast({ type: "log", projectId: id, lines });
}

export function startProject(id: string): { ok: true } | { error: string } {
  const project = getProject(id);
  if (!project) return { error: "project not found" };
  if (!project.runCommand) return { error: "this project has no run command set" };
  if (running.has(id)) return { error: "already running" };
  reapLeftoverGroup(id); // in case a prior backend life orphaned this project's process tree

  // Don't blindly inherit this backend's own PORT — Node's --env-file only
  // fills in a var if it's *not already set*, so leaking our PORT here
  // silently wins over the target project's own .env and makes it bind to
  // our port instead of its own (a real bug: it looked like it started fine
  // but was never actually reachable where the user expected).
  const { PORT: _debuggerOwnPort, ...inheritedEnv } = process.env;

  // detached so the shell gets its own process group — spawn(cmd,{shell:true})
  // only gives us a handle to the shell, and dev commands like `pnpm dev` /
  // `tsx watch` fork their own child processes underneath it; killing just
  // the shell with SIGTERM leaves those orphaned. A process-group kill (see
  // stopProject) reaches the whole tree.
  const isPhp = isPhpCommand(project.runCommand);
  const command = isArtisanServe(project.runCommand)
    ? rewriteArtisanServe(project.runCommand, project.dir)
    : isPhp
      ? injectPhpCapture(project.runCommand)
      : project.runCommand;

  const child = spawn(command, {
    cwd: project.dir,
    shell: true,
    detached: true,
    env: {
      ...inheritedEnv,
      ...(isPhp
        ? {}
        : {
            NODE_OPTIONS: [
              process.env.NODE_OPTIONS,
              `--import ${AUTO_CAPTURE_PATH}`,
              `--import ${INSTRUMENT_PATH}`,
              `--import ${DEBUG_AGENT_PATH}`,
            ]
              .filter(Boolean)
              .join(" "),
          }),
      TTD_API_URL: `http://localhost:${PORT}`,
      TTD_WS_URL: `ws://localhost:${PORT}/debug-ws`,
      TTD_SERVICE_NAME: project.name,
      TTD_PROJECT_ROOT: project.dir,
    },
  });

  if (child.pid) fs.writeFileSync(pidfilePath(id), String(child.pid));

  const rp: RunningProcess = { child, status: "running", logs: [] };
  running.set(id, rp);

  child.stdout?.on("data", (chunk) => pushLog(id, rp, chunk));
  child.stderr?.on("data", (chunk) => pushLog(id, rp, chunk));
  child.on("exit", (code) => {
    rp.status = code === 0 || code === null ? "stopped" : "crashed";
    fs.rmSync(pidfilePath(id), { force: true });
    broadcast({ type: "process-status", projectId: id, status: rp.status });
  });
  child.on("error", () => {
    rp.status = "crashed";
    broadcast({ type: "process-status", projectId: id, status: rp.status });
  });

  broadcast({ type: "process-status", projectId: id, status: "running" });
  return { ok: true };
}

export function stopProject(id: string): { ok: true } | { error: string } {
  const rp = running.get(id);
  if (!rp) return { error: "not running" };
  // Negative pid = kill the whole process group (see the `detached: true`
  // comment in startProject) — reaches pnpm/tsx/node children, not just the
  // shell wrapper spawn() actually gave us a handle to.
  if (rp.child.pid) {
    try {
      process.kill(-rp.child.pid, "SIGTERM");
    } catch {
      rp.child.kill("SIGTERM"); // group already gone — fall back to direct kill
    }
  }
  running.delete(id);
  fs.rmSync(pidfilePath(id), { force: true });
  broadcast({ type: "process-status", projectId: id, status: "stopped" });
  return { ok: true };
}

export function getProjectStatus(id: string): ProcessStatus {
  return running.get(id)?.status ?? "stopped";
}

export function getAllStatuses(): Record<string, ProcessStatus> {
  return Object.fromEntries([...running.entries()].map(([id, rp]) => [id, rp.status]));
}

export function getProjectLogs(id: string): string[] {
  return running.get(id)?.logs ?? [];
}
