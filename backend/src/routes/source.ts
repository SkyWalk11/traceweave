import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { resolveServiceRoot } from "../store.js";

export const sourceRouter = Router();

// Source file reading, restricted to the project bound to this service.
sourceRouter.get("/source", async (req, res) => {
  const file = req.query.file as string | undefined;
  const service = req.query.service as string | undefined;

  const root = resolveServiceRoot(service);
  if (!root) return res.status(400).json({ error: "no project bound to this service" });
  if (!file) return res.status(400).json({ error: "file query param required" });

  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep)) {
    return res.status(403).json({ error: "path outside workspace" });
  }

  try {
    const text = await fs.readFile(resolved, "utf8");
    res.json({ file, text });
  } catch {
    res.status(404).json({ error: "file not found" });
  }
});
