import { continueTrace, endTrace, startTrace, TRACE_HEADER, type FlushOptions } from "./index.js";

// Minimal shape so this file doesn't need @types/express as a dependency.
interface Req {
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  on(event: "finish", listener: () => void): unknown;
}
type Next = () => void;

/**
 * Wraps each request in a trace (continuing one from an upstream service if
 * TRACE_HEADER is present), and flushes buffered steps to the debugger when
 * the response finishes.
 */
export function ttdMiddleware(opts: FlushOptions = {}) {
  return (req: Req, res: Res, next: Next) => {
    const incoming = req.headers[TRACE_HEADER];
    const traceId = Array.isArray(incoming) ? incoming[0] : incoming;
    const run = traceId ? (fn: () => void) => continueTrace(traceId, fn) : startTrace<void>;

    run(() => {
      res.on("finish", () => {
        endTrace(opts);
      });
      next();
    });
  };
}
