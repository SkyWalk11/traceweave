import { Router } from "express";
import {
  addProject,
  bindService,
  getServiceBindings,
  listProjects,
  removeProject,
  updateProject,
} from "../store.js";
import { getAllStatuses, getProjectLogs, getProjectStatus, startProject, stopProject } from "../processes.js";

export const projectsRouter = Router();

// Projects: a registry of local folders, so any number of projects can be
// tracked side by side (not just one "workspace" or one per service).
projectsRouter.get("/projects", (_req, res) => {
  res.json({ projects: listProjects(), serviceBindings: getServiceBindings(), statuses: getAllStatuses() });
});

projectsRouter.post("/projects", async (req, res) => {
  const { name, dir, runCommand } = req.body ?? {};
  if (!dir) return res.status(400).json({ error: "dir is required" });

  try {
    const project = await addProject(name, dir, runCommand);
    res.status(201).json({ project, projects: listProjects() });
  } catch {
    res.status(400).json({ error: "path does not exist or is not a directory" });
  }
});

// Rename anytime; changing the run command only while stopped — it's baked
// into the env/argv of whatever's already spawned, so editing it mid-run
// wouldn't affect the live process anyway and would just be misleading.
projectsRouter.patch("/projects/:id", (req, res) => {
  const { name, runCommand } = req.body ?? {};
  if (runCommand !== undefined && getProjectStatus(req.params.id) === "running") {
    return res.status(400).json({ error: "stop the project before changing its run command" });
  }
  const project = updateProject(req.params.id, { name, runCommand });
  if (!project) return res.status(404).json({ error: "project not found" });
  res.json({ project, projects: listProjects() });
});

projectsRouter.delete("/projects/:id", (req, res) => {
  stopProject(req.params.id); // no-op if not running — avoid leaking a child process
  const removed = removeProject(req.params.id);
  if (!removed) return res.status(404).json({ error: "project not found" });
  res.json({ projects: listProjects(), serviceBindings: getServiceBindings() });
});

// Run/stop a project's dev command, with capture auto-injected into its env.
projectsRouter.post("/projects/:id/start", (req, res) => {
  const result = startProject(req.params.id);
  if ("error" in result) return res.status(400).json(result);
  res.json(result);
});

projectsRouter.post("/projects/:id/stop", (req, res) => {
  const result = stopProject(req.params.id);
  if ("error" in result) return res.status(400).json(result);
  res.json(result);
});

projectsRouter.get("/projects/:id/logs", (req, res) => {
  res.json({ lines: getProjectLogs(req.params.id) });
});

// Service bindings: which registered project each service reads from
projectsRouter.post("/service-binding", (req, res) => {
  const { service, projectId } = req.body ?? {};
  if (!service) return res.status(400).json({ error: "service is required" });

  const ok = bindService(service, projectId ?? null);
  if (!ok) return res.status(400).json({ error: "unknown projectId" });
  res.json({ serviceBindings: getServiceBindings() });
});
