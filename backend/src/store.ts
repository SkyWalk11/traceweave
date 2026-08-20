import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import type { Project, ServiceBindings, TracePayload } from "./types.js";

// ponytail: in-memory only, no DB — traces/projects are debugging aids, not durable data.
const traces: TracePayload[] = [];
const projects: Project[] = [];
const serviceBindings: ServiceBindings = {};

export function listTraces(): TracePayload[] {
  return traces;
}

// Multiple services in the same logical flow each flush their own buffered
// steps independently (see the capture SDK), so incoming payloads sharing a
// traceId are merged into one trace rather than kept as separate entries.
// Steps are re-sorted by timestamp so cross-service execution order is
// preserved even though they arrived in separate HTTP requests.
export function addTrace(incoming: TracePayload): TracePayload {
  const existing = traces.find((t) => t.traceId === incoming.traceId);
  if (!existing) {
    traces.push(incoming);
    return incoming;
  }

  existing.steps = [...existing.steps, ...incoming.steps].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  return existing;
}

export function listProjects(): Project[] {
  return projects;
}

export function getServiceBindings(): ServiceBindings {
  return serviceBindings;
}

export async function assertDirectory(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error("not a directory");
  return resolved;
}

export async function addProject(name: string, dir: string, runCommand?: string): Promise<Project> {
  const resolved = await assertDirectory(dir);
  const project: Project = {
    id: crypto.randomUUID(),
    name: name || path.basename(resolved),
    dir: resolved,
    ...(runCommand ? { runCommand } : {}),
  };
  projects.push(project);
  return project;
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export function updateProject(id: string, patch: { name?: string; runCommand?: string }): Project | null {
  const project = projects.find((p) => p.id === id);
  if (!project) return null;
  if (patch.name !== undefined && patch.name.trim()) project.name = patch.name.trim();
  if (patch.runCommand !== undefined) {
    if (patch.runCommand.trim()) project.runCommand = patch.runCommand.trim();
    else delete project.runCommand;
  }
  return project;
}

export function removeProject(id: string): boolean {
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  for (const service of Object.keys(serviceBindings)) {
    if (serviceBindings[service] === id) delete serviceBindings[service];
  }
  return true;
}

export function bindService(service: string, projectId: string | null): boolean {
  if (projectId === null) {
    delete serviceBindings[service];
    return true;
  }
  if (!projects.some((p) => p.id === projectId)) return false;
  serviceBindings[service] = projectId;
  return true;
}

export function resolveServiceRoot(service: string | undefined): string | null {
  const projectId = service && serviceBindings[service];
  const project = projectId && projects.find((p) => p.id === projectId);
  return project ? project.dir : null;
}
