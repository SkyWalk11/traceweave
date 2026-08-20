// Runtime half of the auto-instrumentation loader (instrument.ts). Kept as
// its own tiny module so instrumented files can import it via an absolute
// path our loader's `resolve` hook injects — the target project never needs
// this (or ttd-capture at all) installed as a dependency.
import { recordStep } from "./index.js";

// Since every function parameter gets captured automatically (not opted
// into like manual recordStep() calls), this will regularly see things that
// were never meant to be "data" — a raw Node `req`/`res`, a socket, a
// stream, a class instance, a callback. Keep primitives, plain objects, and
// arrays as-is (small values only); reduce anything else to a short
// descriptive placeholder instead of walking it — cheaper than serializing
// megabytes of Node internals only to throw them away, and far more
// readable in the UI than a wall of "[Circular]".
function snapshot(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (type === "bigint") return (value as bigint).toString();
  if (type === "function") return `[Function: ${(value as { name?: string }).name || "anonymous"}]`;
  if (type !== "object") return String(value);

  if (depth >= 2) return Array.isArray(value) ? `[Array(${(value as unknown[]).length})]` : "[Object]";

  if (Array.isArray(value)) return value.slice(0, 20).map((v) => snapshot(v, depth + 1));

  // Node's own classes (IncomingMessage, Socket, ...) don't set
  // Symbol.toStringTag, so Object.prototype.toString on them is
  // indistinguishable from a plain "{}" literal — the actual reliable check
  // for "is this a plain object" is the constructor identity.
  const ctor = (value as object).constructor;
  if (ctor !== undefined && ctor !== Object) {
    return `[${ctor.name || "Object"}]`;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).slice(0, 30)) {
    out[key] = snapshot((value as Record<string, unknown>)[key], depth + 1);
  }
  return out;
}

export function __ttdRecordCall(
  file: string,
  line: number,
  functionName: string,
  params: Record<string, unknown>
): void {
  const inputs: Record<string, unknown> = {};
  for (const key of Object.keys(params)) inputs[key] = snapshot(params[key]);

  recordStep({
    service: process.env.TTD_SERVICE_NAME ?? "unknown-service",
    file,
    line,
    function: functionName,
    inputs,
  });
}
