import { Router } from "express";
import { addTrace, listTraces } from "../store.js";
import { broadcast } from "../ws.js";
import type { TracePayload } from "../types.js";

export const tracesRouter = Router();

// Trace Payload: { traceId: string, steps: StepSnapshot[] }
// StepSnapshot: { service, file, line, function, inputs, locals, timestamp }
tracesRouter.post("/traces", (req, res) => {
  const trace = req.body as TracePayload;
  if (!trace?.traceId || !Array.isArray(trace.steps)) {
    return res.status(400).json({ error: "trace must have traceId and steps[]" });
  }
  const merged = addTrace(trace);
  broadcast({ type: "trace", trace: merged });
  res.status(201).json({ ok: true });
});

tracesRouter.get("/traces", (_req, res) => res.json(listTraces()));
