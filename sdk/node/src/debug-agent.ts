// Real per-line/variable capture with zero source edits, via V8's own
// Inspector protocol (the engine behind Chrome DevTools) — not the manual
// recordStep()/auto HTTP-boundary capture in index.ts/auto.ts.
//
// How it stays non-blocking: breakpoints set from the debugger UI are
// "logpoints" — when hit, V8 pauses, we immediately read local scope
// variables over the inspector session, then resume in the same tick. The
// process never meaningfully stops; it behaves like a Chrome DevTools
// logpoint, not a real breakpoint debugger.
//
// Deliberately uses the plain callback-based `node:inspector` API, NOT
// `node:inspector/promises`: an in-process pause freezes the very Promise
// microtask queue that `await session.post(...)` depends on to resolve, so
// promise-based resume calls made from inside a Debugger.paused handler
// never actually run — a real deadlock, reproduced while building this
// (froze a live process's entire event loop, not just the paused request).
// Callbacks are invoked directly by V8's own debugger message pump instead,
// independent of the microtask queue, so they fire even while paused.
//
// Also requires real source-map translation, not a naive line number pass-
// through: tsx (esbuild) minifies each module onto essentially one line at
// runtime, embedding a source map back to the original file only for stack
// traces. A breakpoint request for "original file, line N" has to be
// translated to the *generated* script's line/column via that source map —
// otherwise it silently targets a location V8 never actually reaches.
//
// Loaded via `--import ttd-capture/debug-agent` (same delivery as auto.ts).
// Requires TTD_WS_URL (e.g. ws://localhost:4000/debug-ws) — set automatically
// when a project is started through the debugger UI's process orchestration.
import path from "node:path";
import { Session } from "node:inspector";
import { TraceMap, generatedPositionFor, LEAST_UPPER_BOUND, type SourceMapInput } from "@jridgewell/trace-mapping";

const WS_URL = process.env.TTD_WS_URL;
const SERVICE = process.env.TTD_SERVICE_NAME ?? "unknown-service";

interface CdpRemoteObject {
  type: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

interface CdpProperty {
  name: string;
  enumerable?: boolean;
  value?: CdpRemoteObject;
}

interface CdpScope {
  type: string;
  object: { objectId: string };
}

interface CdpCallFrame {
  functionName?: string;
  scopeChain?: CdpScope[];
}

interface CdpPausedParams {
  hitBreakpoints?: string[];
  callFrames?: CdpCallFrame[];
}

interface ScriptInfo {
  scriptId: string;
  tracer: TraceMap | null; // null if no usable inline source map was found
}

if (WS_URL) startDebugAgent(WS_URL);

function startDebugAgent(wsUrl: string): void {
  const session = new Session();
  session.connect();
  session.post("Debugger.enable", {}, (err) => {
    if (err) console.error(`[ttd-capture] Debugger.enable failed:`, err);
  });
  session.post("Runtime.enable", {}, (err) => {
    if (err) console.error(`[ttd-capture] Runtime.enable failed:`, err);
  });

  const breakpoints = new Map<string, { file: string; line: number }>(); // breakpointId -> location
  const scriptsByFile = new Map<string, ScriptInfo>(); // absolute source path -> script info
  const pending = new Map<string, Array<{ line: number; cb: (id: string | null) => void }>>(); // absolute path -> queued requests

  session.on("Debugger.scriptParsed", (message) => {
    const p = message.params as { scriptId: string; url: string };
    if (!p.url.startsWith("file://")) return;

    session.post("Debugger.getScriptSource", { scriptId: p.scriptId }, (err, result) => {
      if (err || !result) return;
      const source = (result as { scriptSource: string }).scriptSource;
      const absolutePath = fileUrlToPath(p.url);
      const tracer = extractTracer(source);
      scriptsByFile.set(absolutePath, { scriptId: p.scriptId, tracer });

      const queued = pending.get(absolutePath);
      if (queued) {
        pending.delete(absolutePath);
        for (const { line, cb } of queued) resolveAndSetBreakpoint(session, absolutePath, line, scriptsByFile, cb);
      }
    });
  });

  console.log(`[ttd-capture] debug agent connecting to ${wsUrl} as "${SERVICE}"`);
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", service: SERVICE }));
    console.log(`[ttd-capture] debug agent connected`);
  });
  ws.addEventListener("error", (event) => {
    console.error(`[ttd-capture] debug agent websocket error:`, event);
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    let msg: { type: string; file: string; line: number };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (msg.type === "set-breakpoint") {
      const absolutePath = path.resolve(process.cwd(), msg.file);
      const onResolved = (breakpointId: string | null) => {
        if (breakpointId) {
          breakpoints.set(breakpointId, { file: msg.file, line: msg.line });
          console.log(`[ttd-capture] breakpoint set: ${msg.file}:${msg.line}`);
        } else {
          console.error(`[ttd-capture] failed to set breakpoint: ${msg.file}:${msg.line}`);
        }
      };

      if (scriptsByFile.has(absolutePath)) {
        resolveAndSetBreakpoint(session, absolutePath, msg.line, scriptsByFile, onResolved);
      } else {
        // Script not loaded/parsed yet — queue and resolve once scriptParsed arrives.
        const list = pending.get(absolutePath) ?? [];
        list.push({ line: msg.line, cb: onResolved });
        pending.set(absolutePath, list);
      }
    } else if (msg.type === "remove-breakpoint") {
      for (const [id, bp] of breakpoints) {
        if (bp.file === msg.file && bp.line === msg.line) {
          session.post("Debugger.removeBreakpoint", { breakpointId: id }, () => {});
          breakpoints.delete(id);
        }
      }
    }
  });

  session.on("Debugger.paused", (message) => {
    const params = message.params as CdpPausedParams;
    console.log(`[ttd-capture] Debugger.paused fired, hitBreakpoints=`, params.hitBreakpoints);
    handlePaused(session, ws, breakpoints, params);
  });
}

function fileUrlToPath(url: string): string {
  return decodeURIComponent(url.replace(/^file:\/\//, ""));
}

// tsx/esbuild inline the source map as a base64 data URI comment at the end
// of the generated script. Everything else about the original file (types,
// multi-line formatting) is gone by the time V8 sees it — this comment is
// the only link back to real source coordinates.
function extractTracer(source: string): TraceMap | null {
  const match = source.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/);
  if (!match) return null;
  try {
    const json = Buffer.from(match[1], "base64").toString("utf8");
    return new TraceMap(JSON.parse(json) as SourceMapInput);
  } catch {
    return null;
  }
}

function resolveAndSetBreakpoint(
  session: Session,
  absolutePath: string,
  originalLine: number,
  scriptsByFile: Map<string, ScriptInfo>,
  cb: (breakpointId: string | null) => void
): void {
  const info = scriptsByFile.get(absolutePath);
  if (!info) return cb(null);

  let lineNumber: number;
  let columnNumber: number;

  if (info.tracer) {
    // column: 0 rarely has an exact mapping (real statements are indented) —
    // LEAST_UPPER_BOUND finds the nearest mapped column at or after it on
    // that original line, i.e. the actual start of the first statement.
    const pos = generatedPositionFor(info.tracer, {
      source: absolutePath,
      line: originalLine,
      column: 0,
      bias: LEAST_UPPER_BOUND,
    });
    if (pos.line === null) return cb(null); // original line has no mapped generated code (e.g. blank line, type-only line)
    lineNumber = pos.line - 1; // trace-mapping is 1-based; CDP is 0-based
    columnNumber = pos.column ?? 0;
  } else {
    // No source map found — best effort, assume 1:1 (correct for plain .js).
    lineNumber = originalLine - 1;
    columnNumber = 0;
  }

  session.post(
    "Debugger.setBreakpoint",
    { location: { scriptId: info.scriptId, lineNumber, columnNumber } },
    (err, result) => {
      if (err) console.error(`[ttd-capture] Debugger.setBreakpoint error:`, err);
      cb(!err && result ? (result as { breakpointId: string }).breakpointId : null);
    }
  );
}

function handlePaused(
  session: Session,
  ws: WebSocket,
  breakpoints: Map<string, { file: string; line: number }>,
  params: CdpPausedParams
): void {
  const resume = () => session.post("Debugger.resume", {}, () => {});

  const hitId = params.hitBreakpoints?.[0];
  const bp = hitId ? breakpoints.get(hitId) : undefined;
  const frame = params.callFrames?.[0];

  if (!bp || !frame) return resume();

  readLocals(session, frame, (locals) => {
    ws.send(
      JSON.stringify({
        type: "hit",
        file: bp.file,
        line: bp.line,
        function: frame.functionName || "(anonymous)",
        locals,
      })
    );
    // Resume immediately — this is what makes it a logpoint, not a breakpoint.
    resume();
  });
}

// v1: only the innermost "local" scope (function params + locals declared so
// far) — covers what a debugger's Locals panel shows in the common case,
// without the callback-counting complexity of merging multiple scopes.
function readLocals(session: Session, frame: CdpCallFrame, cb: (locals: Record<string, unknown>) => void): void {
  const scope = (frame.scopeChain ?? []).find((s) => s.type === "local");
  if (!scope) return cb({});

  session.post("Runtime.getProperties", { objectId: scope.object.objectId, ownProperties: true }, (err, result) => {
    if (err || !result) return cb({});
    const props = (result as { result: CdpProperty[] }).result.filter((p) => p.name !== "this" && p.value);
    if (props.length === 0) return cb({});

    const out: Record<string, unknown> = {};
    let pendingCount = props.length;
    for (const prop of props) {
      simplify(session, prop.value!, (val) => {
        out[prop.name] = val;
        if (--pendingCount === 0) cb(out);
      });
    }
  });
}

function simplify(session: Session, remote: CdpRemoteObject, cb: (value: unknown) => void): void {
  if (remote.type === "undefined") return cb(undefined);
  if ("value" in remote) return cb(remote.value); // primitives

  if (remote.type === "object" && remote.objectId) {
    session.post("Runtime.getProperties", { objectId: remote.objectId, ownProperties: true }, (err, result) => {
      if (err || !result) return cb(remote.description ?? "[object]");
      const props = (result as { result: CdpProperty[] }).result
        .filter((p) => p.enumerable && p.value)
        .slice(0, 20);
      const obj: Record<string, unknown> = {};
      for (const prop of props) {
        obj[prop.name] = "value" in prop.value! ? prop.value!.value : prop.value!.description;
      }
      cb(obj);
    });
    return;
  }

  cb(remote.description ?? null);
}
