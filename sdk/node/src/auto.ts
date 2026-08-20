// Zero-source-edit capture. Load with `node --import ttd-capture/auto app.js`
// (or NODE_OPTIONS="--import ttd-capture/auto") — no changes to your code.
//
// Trade-off vs. calling recordStep() yourself: this only sees the HTTP
// boundary (method, url, headers, status, duration), not internal
// function/line/local-variable detail, since it never touches your source.
// It deliberately does NOT read the request body — tee-ing a request stream
// risks racing your app's own body parser and corrupting what it reads.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { AsyncResource } from "node:async_hooks";
import { continueTrace, startTrace, recordStep, endTrace, traceHeader, TRACE_HEADER } from "./index.js";

function inferServiceName(): string {
  if (process.env.TTD_SERVICE_NAME) return process.env.TTD_SERVICE_NAME;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    if (pkg.name) return pkg.name;
  } catch {
    // fall through
  }
  return path.basename(process.cwd());
}

function safeHeaders(headers: http.IncomingHttpHeaders): Record<string, unknown> {
  const { authorization, cookie, ...rest } = headers;
  return rest;
}

const service = inferServiceName();
const originalEmit = http.Server.prototype.emit;
const alreadyPatched = (http.Server.prototype as { __ttdPatched?: boolean }).__ttdPatched;

if (!alreadyPatched) {
  (http.Server.prototype as { __ttdPatched?: boolean }).__ttdPatched = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http.Server.prototype.emit = function (event: string, ...args: any[]): boolean {
    if (event !== "request") return originalEmit.apply(this, [event, ...args]);

    const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
    const incoming = req.headers[TRACE_HEADER];
    const traceId = Array.isArray(incoming) ? incoming[0] : incoming;
    const start = Date.now();

    const run = (fn: () => void) => (traceId ? continueTrace(traceId, fn) : startTrace(fn));

    let handled: boolean = false;
    run(() => {
      // Some apps read the request body with their own raw req.on('data'/'end')
      // listeners instead of express.json()/similar — reproduced empirically
      // that this breaks Node's AsyncLocalStorage propagation past that point,
      // silently losing the trace context for everything downstream (not just
      // this SDK — any ALS-based tracing would have the same problem). Binding
      // this specific callback to the resource captured *now* (before that can
      // happen) keeps this top-level HTTP-boundary capture working even then.
      const flush = AsyncResource.bind(() => {
        recordStep({
          service,
          file: "(auto-captured — no source file, since nothing was instrumented)",
          function: `${req.method} ${req.url}`,
          line: 0,
          inputs: { method: req.method, url: req.url, headers: safeHeaders(req.headers) },
          locals: { statusCode: res.statusCode, durationMs: Date.now() - start },
        });
        endTrace();
      });
      res.on("finish", flush);
      handled = originalEmit.apply(this, [event, ...args]);
    });
    return handled;
  };
}

// Without this, a call MID makes to CORE starts a brand-new trace on CORE's
// side instead of continuing this one — the two never merge into a single
// steppable trace, and the debugger UI's per-service panes only render
// services present in the trace you're currently viewing, so CORE simply
// never shows up. Patches http(s).request, http(s).get, and fetch — .get is
// NOT just a thin wrapper around the exported .request from the caller's
// perspective: Node's internal `get()` closes over its own module-private
// `request` reference, not the mutable `exports.request` property, so
// patching only `.request` silently leaves `.get` (and anything using it,
// e.g. many simple HTTP client calls) unpropagated. Confirmed empirically —
// patching only `request` left `get`'s downstream header missing.
function injectTraceHeaderArg(args: unknown[]): void {
  const hdr = traceHeader();
  if (!hdr[TRACE_HEADER]) return;
  // (url), (url, options), (options), each optionally followed by a
  // callback — the options object (if present) is whichever of the first
  // two args is a plain object, not a URL/string/callback.
  const optsIndex = args.findIndex(
    (a) => a && typeof a === "object" && typeof a !== "function" && !(a instanceof URL)
  );
  if (optsIndex !== -1) {
    const opts = args[optsIndex] as { headers?: Record<string, unknown> };
    args[optsIndex] = { ...opts, headers: { ...opts.headers, ...hdr } };
  } else {
    args.splice(1, 0, { headers: hdr });
  }
}

type RequestFn = typeof http.request;
function patchOutgoing(mod: { request: RequestFn; get: RequestFn }, key: string): void {
  if ((mod as Record<string, unknown>)[key]) return;
  (mod as Record<string, unknown>)[key] = true;

  for (const name of ["request", "get"] as const) {
    const original = mod[name];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod[name] = function (this: unknown, ...args: any[]): http.ClientRequest {
      injectTraceHeaderArg(args);
      return original.apply(this, args as Parameters<RequestFn>);
    } as RequestFn;
  }
}

const httpPatchFlag = "__ttdOutgoingPatched";
patchOutgoing(http as unknown as { request: RequestFn; get: RequestFn } & Record<string, unknown>, httpPatchFlag);
patchOutgoing(https as unknown as { request: RequestFn; get: RequestFn } & Record<string, unknown>, httpPatchFlag);

const globalWithFetch = globalThis as { fetch?: typeof fetch; __ttdFetchPatched?: boolean };
if (globalWithFetch.fetch && !globalWithFetch.__ttdFetchPatched) {
  globalWithFetch.__ttdFetchPatched = true;
  const originalFetch = globalWithFetch.fetch;
  globalWithFetch.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const hdr = traceHeader();
    if (!hdr[TRACE_HEADER]) return originalFetch(input, init);
    return originalFetch(input, { ...init, headers: { ...init?.headers, ...hdr } });
  };
}
