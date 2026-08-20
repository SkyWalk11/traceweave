import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export interface StepInput {
  service: string;
  file: string;
  line: number;
  function?: string;
  inputs?: Record<string, unknown>;
  locals?: Record<string, unknown>;
}

interface RecordedStep extends StepInput {
  timestamp: number;
}

interface TraceContext {
  traceId: string;
  steps: RecordedStep[];
}

// AsyncLocalStorage (not a plain module-level variable) so concurrent
// requests in the same process each see their own trace, not each other's.
const als = new AsyncLocalStorage<TraceContext>();

export const TRACE_HEADER = "x-ttd-trace-id";

/** Starts a brand-new trace and runs `fn` inside it. Use at a flow's entry point. */
export function startTrace<T>(fn: () => T): T {
  return als.run({ traceId: crypto.randomUUID(), steps: [] }, fn);
}

/** Continues a trace begun by an upstream service (read `traceId` from TRACE_HEADER). */
export function continueTrace<T>(traceId: string, fn: () => T): T {
  return als.run({ traceId, steps: [] }, fn);
}

/** The active trace's id, or undefined if called outside startTrace/continueTrace. */
export function currentTraceId(): string | undefined {
  return als.getStore()?.traceId;
}

/** Header(s) to attach to an outgoing HTTP request so the next service continues this trace. */
export function traceHeader(): Record<string, string> {
  const id = currentTraceId();
  return id ? { [TRACE_HEADER]: id } : {};
}

/**
 * Records one step (function entry, a line of interest, etc). No-ops silently
 * outside an active trace, so it's safe to sprinkle into code paths that
 * might run without a trace (e.g. a health check).
 */
export function recordStep(step: StepInput): void {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.steps.push({ ...step, timestamp: Date.now() });
}

export interface FlushOptions {
  /** Debugger backend base URL. Defaults to TTD_API_URL env var, then localhost:4000. */
  apiUrl?: string;
}

/** Sends the current trace's buffered steps to the debugger backend and clears them. */
export async function endTrace(opts: FlushOptions = {}): Promise<void> {
  const ctx = als.getStore();
  if (!ctx || ctx.steps.length === 0) return;

  const apiUrl = opts.apiUrl ?? process.env.TTD_API_URL ?? "http://localhost:4000";
  const steps = ctx.steps;
  ctx.steps = [];

  // Capture must never crash the host app: a caller-supplied `inputs`/`locals`
  // value can be anything (a circular Node object was reproduced doing
  // exactly this) — JSON.stringify throwing here would otherwise be an
  // uncaught exception in whatever context flushes the trace.
  let body: string;
  try {
    body = safeStringify({ traceId: ctx.traceId, steps });
  } catch {
    return;
  }

  await fetch(`${apiUrl}/api/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Capture must never crash the host app over a debugger-connectivity blip.
  });
}

/** JSON.stringify that can't throw on circular references or exotic values. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Error) return { name: val.name, message: val.message };
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}
