import { Router } from "express";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export const browseRouter = Router();

// Directory browsing, to pick a project folder from the UI.
browseRouter.get("/browse", async (req, res) => {
  const dir = path.resolve((req.query.dir as string) || os.homedir());

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return res.status(400).json({ error: "cannot read directory" });
  }

  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  res.json({ dir, parent: path.dirname(dir), folders });
});
