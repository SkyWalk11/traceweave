import { Router } from "express";
import { activateWorkspace, createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace } from "../store.js";

export const workspacesRouter = Router();

// Workspaces: named, switchable groups of projects/bindings/recent traces —
// so re-opening the debugger (or hopping between unrelated stacks) doesn't
// mean re-adding every project by hand each time.
workspacesRouter.get("/workspaces", (_req, res) => {
  res.json({ workspaces: listWorkspaces() });
});

workspacesRouter.post("/workspaces", (req, res) => {
  const { name, activate } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });
  const workspace = createWorkspace(String(name));
  if (activate) activateWorkspace(workspace.id);
  res.status(201).json({ workspaces: listWorkspaces() });
});

workspacesRouter.post("/workspaces/:id/activate", (req, res) => {
  const ok = activateWorkspace(req.params.id);
  if (!ok) return res.status(404).json({ error: "workspace not found" });
  res.json({ workspaces: listWorkspaces() });
});

workspacesRouter.patch("/workspaces/:id", (req, res) => {
  const ok = renameWorkspace(req.params.id, req.body?.name ?? "");
  if (!ok) return res.status(400).json({ error: "name is required or workspace not found" });
  res.json({ workspaces: listWorkspaces() });
});

workspacesRouter.delete("/workspaces/:id", (req, res) => {
  const result = deleteWorkspace(req.params.id);
  if ("error" in result) return res.status(400).json(result);
  res.json({ workspaces: listWorkspaces() });
});
