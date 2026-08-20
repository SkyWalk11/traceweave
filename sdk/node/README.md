# ttd-capture

Minimal capture SDK for [Traceweave](../../README.md). Import it into your
real Node.js services to record step snapshots as your code actually runs, instead of
hand-writing trace JSON.

Not published to npm — it's part of this repo. Reference it locally (`file:../sdk/node` in
your `package.json`, or a relative import if it's in the same workspace) and build it with
`npm run build` here first.

## What it does — and doesn't

- Generates a `traceId` at a flow's entry point and propagates it across services via an
  HTTP header, so steps recorded in different processes merge into one trace.
- Buffers steps in-process (safe under concurrent requests, via `AsyncLocalStorage`) and
  flushes them to the debugger backend's `POST /api/traces` when you call `endTrace()`.
- Four ways to capture, with real trade-offs between them — see the sections below.
- Neither one detects whether your service is "running" — that's a separate concern from the
  debugger's Projects/folder binding, which only controls where source is read from for display.

## Zero-edit capture (`ttd-capture/auto`)

No source changes at all — launch your existing app with an extra flag:

```bash
node --import ttd-capture/auto app.js
# or: NODE_OPTIONS="--import ttd-capture/auto" node app.js
```

It patches `http.Server` at the prototype level (so it works under Express, Fastify, or plain
`node:http`), auto-generating/continuing a `traceId` per request and recording one step per
request with method, url, headers, status, and duration.

**Trade-off**: this only sees the HTTP boundary. No internal function/line detail, no local
variables, no request body (deliberately — tee-ing the request stream risks racing your own
body parser and corrupting what it reads). For that, use `recordStep()` yourself (below).

Service name: `TTD_SERVICE_NAME` env var if set, else your `package.json`'s `name`, else the
current directory's name.

## Live logpoint capture (`ttd-capture/debug-agent`) — real per-line/variable detail, zero edits

Also zero source changes, but gets you real per-line/variable detail that `/auto` can't:
click a line's gutter in the debugger UI's Monaco pane, and it sets a real V8 breakpoint in
your running process — no `recordStep()` calls needed anywhere.

Loaded the same way as `/auto` — in fact, the debugger UI's "▶ Start" button injects both
automatically when a project has a run command, so in normal use you never touch this
directly. Requires `TTD_WS_URL` (e.g. `ws://localhost:4000/debug-ws`), also set automatically
by that same orchestration.

**How it stays non-blocking**: each breakpoint is really a *logpoint* — when hit, V8 pauses,
the agent reads local scope variables over an in-process Inspector session, sends them to the
debugger, then resumes in the same tick. It behaves like a Chrome DevTools logpoint, not a
real breakpoint debugger; your process never meaningfully stops.

**Real implementation notes, not just marketing**:
- Uses the plain callback-based `node:inspector` API, not `node:inspector/promises` — an
  in-process pause freezes the Promise microtask queue that `await session.post(...)` needs to
  resolve, so promise-based resume calls made from inside the pause handler never actually run.
  This was reproduced for real while building it: it froze a live process's entire event loop,
  not just the paused request. Callbacks are invoked directly by V8's own debugger message
  pump, independent of the microtask queue, so they fire even while paused.
- Requires real source-map translation, not a line-number pass-through: `tsx`/esbuild minifies
  each module onto essentially one line at runtime, embedding a source map back to the
  original file only for stack traces. A breakpoint request for "original file, line N" is
  translated to the *generated* script's exact line/column via that embedded map
  (`@jridgewell/trace-mapping`) before being set — otherwise it silently targets a location V8
  never reaches, and nothing ever fires.
- v1 only reads the innermost "local" scope (function params + locals declared so far in that
  function) — not closure/outer-scope variables.

## Auto-instrumentation (`ttd-capture/instrument`) — comprehensive, zero edits, no pausing

The main capture path. Zero source changes, no V8 breakpoints/pausing at all: injects a
recording call at the start of *every function* in your project's own files, so every call
records its file/function/params automatically as your code runs normally.

```bash
node --import ttd-capture/auto --import ttd-capture/instrument app.js
```

Needs `ttd-capture/auto` loaded alongside it (for the per-request trace context and
flush-on-response) — the debugger UI's "▶ Start" button injects both together automatically,
so in normal use you don't touch this directly.

**How**: a Node module-customization hook (`module.registerHooks`, synchronous/same-thread —
not the deprecated `module.register`) intercepts every file load under your project directory
and transforms it with the TypeScript compiler's AST API, inserting `__ttdRecordCall(file,
line, function, params)` at the top of each function body, then imports the recording runtime
via an injected import your project never has to install (the loader's own `resolve` hook
redirects that specifier straight to this package's absolute path).

**Real implementation notes, from bugs actually hit building this**:
- **Line numbers need source-map translation, in the reverse direction from debug-agent's**:
  this hook runs *after* `tsx`'s own load hook in the chain, so the source text it receives to
  parse is already `tsx`/esbuild's minified, single-physical-line output — reading a line
  number directly off that AST reports "line 1" for everything, regardless of the real
  location (reproduced empirically). The fix reuses `@jridgewell/trace-mapping`
  (`originalPositionFor`) to translate the minified position back to the real source line
  before injecting it as a literal.
- **Captured parameter values must never be serialized raw**: every parameter gets captured
  automatically, including things like a raw Node `req`/`res` — which contains a genuine
  circular reference (`req.socket...req`). `JSON.stringify`ing that in `endTrace()` **crashed
  the entire host process** the first time this ran end-to-end (an uncaught exception outside
  any try/catch, in the `'finish'` event callback). Fixed two ways: (1) `endTrace()`'s
  serialization is now circular/exotic-value-safe regardless of what's passed to it, and (2)
  captured values are snapshotted at the source — primitives/plain-objects/arrays are kept
  (depth- and size-capped), anything else (a class instance, a Node built-in, a function)
  becomes a short placeholder like `"[IncomingMessage]"` instead of being walked. Note plain
  `Object.prototype.toString`/`Symbol.toStringTag` can't tell a class instance from a plain
  object here — Node's own classes don't set a tag — so the check is the constructor identity
  (`value.constructor === Object`) instead.
- Position info only survives on a node *before* `ts.visitEachChild` reconstructs it — once a
  descendant changes, the parent's rebuilt node carries synthesized (meaningless) positions, so
  the line has to be read from the original node ahead of that call, not after.
- Skips `node_modules` and this SDK's own runtime file (by exact path, not by directory prefix
  — a target project that happens to contain this SDK's own directory would otherwise match on
  a broader exclusion and instrument nothing, an edge case hit while testing against the
  example in this very repo).
- v1 only instruments block-bodied functions/methods/arrows (`function`, `const f = () => {
  ... }`) — concise-body arrows (`x => x + 1`) are skipped, not worth the added complexity of
  wrapping an expression body.

## Manual capture (`recordStep()`) — real per-line/variable detail, requires code edits

## API

```ts
import { startTrace, continueTrace, recordStep, traceHeader, endTrace, TRACE_HEADER } from "ttd-capture";

// Entry point of a request/flow:
startTrace(async () => {
  recordStep({
    service: "order-service",
    file: "src/order.ts",   // relative to the project folder you bind this service to in the UI
    function: "checkout",
    line: 42,
    inputs: { userId },
    locals: { total },
  });

  // Calling another service? Attach the trace header so it continues the same trace:
  await fetch("http://payment-service/charge", {
    headers: { "Content-Type": "application/json", ...traceHeader() },
    ...
  });

  await endTrace(); // sends buffered steps to the debugger backend
});
```

In the downstream service, read the header and continue the trace instead of starting a new one:

```ts
import { continueTrace, recordStep, endTrace, TRACE_HEADER } from "ttd-capture";

const traceId = req.headers[TRACE_HEADER];
const run = traceId ? (fn) => continueTrace(traceId, fn) : (fn) => fn();

run(async () => {
  recordStep({ service: "payment-service", file: "src/charge.ts", function: "charge", line: 12, inputs, locals });
  await endTrace();
});
```

`endTrace({ apiUrl })` defaults to `process.env.TTD_API_URL`, then `http://localhost:4000`.

### Express

```ts
import { ttdMiddleware } from "ttd-capture/express";
app.use(ttdMiddleware());
```

Wraps each request in a trace automatically (continuing one from `TRACE_HEADER` if present)
and flushes on response finish — you still call `recordStep()` yourself inside handlers.

## Examples

`examples/two-services/` — manual capture, two plain `node:http` servers, `order-service`
propagating a trace to `payment-service` over HTTP:

```bash
npm run build
npm run example:a   # order-service on :5001
npm run example:b   # payment-service on :5002 (separate terminal)
curl localhost:5001/checkout
```

`examples/auto/service.ts` — zero-edit capture, no `recordStep()` calls anywhere in it:

```bash
npm run build
npm run example:auto   # :5003
curl -X POST localhost:5003/anything -d '{"hello":"world"}' -H 'Content-Type: application/json'
```

`examples/debug/service.ts` — a disposable target for testing the logpoint mechanism safely
before pointing it at anything real:

```bash
npm run build
TTD_WS_URL=ws://localhost:4000/debug-ws TTD_SERVICE_NAME=debug-test \
  npx tsx --import ./dist/debug-agent.js examples/debug/service.ts   # :5004
```

Then set a breakpoint (either by clicking the gutter in the debugger UI, or directly:
`curl -X POST localhost:4000/api/breakpoints -d '{"service":"debug-test","file":"examples/debug/service.ts","line":9,"enabled":true}' -H 'Content-Type: application/json'`),
then `curl localhost:5004` — a trace with real captured locals shows up, and the request still
returns immediately.

`examples/debug/service.ts` is also the auto-instrumentation's test target:

```bash
npm run build
TTD_API_URL=http://localhost:4000 TTD_SERVICE_NAME=instrument-test \
  npx tsx --import ./dist/auto.js --import ./dist/instrument.js examples/debug/service.ts   # :5004
curl localhost:5004
```

— captures `handleOrder`'s real params and the request handler's file/line, with zero
`recordStep()` calls anywhere in the file.

Then in the debugger UI, add this folder (`sdk/node`) as a project and bind the relevant
service name(s) to it — the real trace each example produces will show up with a real
generated `traceId`, steppable (and for the manual example, across both services).
