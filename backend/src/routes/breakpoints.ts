import { Router } from "express";
import { removeBreakpoint, setBreakpoint } from "../debugAgents.js";

export const breakpointsRouter = Router();

breakpointsRouter.post("/breakpoints", (req, res) => {
  const { service, file, line, enabled } = req.body ?? {};
  if (!service || !file || typeof line !== "number") {
    return res.status(400).json({ error: "service, file, line are required" });
  }

  const ok = enabled === false ? removeBreakpoint(service, file, line) : setBreakpoint(service, file, line);
  if (!ok) return res.status(400).json({ error: "no debug agent connected for this service" });
  res.json({ ok: true });
});
