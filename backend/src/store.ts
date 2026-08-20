import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { db } from "./db.js";
import type { Project, ServiceBindings, TracePayload } from "./types.js";

// Everything below is scoped to the *active* workspace — a named group of
// projects/bindings/traces, so switching workspace swaps the whole registered
// stack at once instead of one project at a time. Backed by sqlite (built
// into Node via node:sqlite) so it survives restarts instead of resetting.
const MAX_TRACES_PER_WORKSPACE = 200;

export interface Workspace {
  id: string;
  name: string;
  active: boolean;
}

function activeWorkspaceId(): string {
  const row = db.prepare("SELECT id FROM workspaces WHERE active = 1 LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (row) return row.id;
  // Shouldn't happen (db.ts seeds one), but don't leave every query with
  // nothing to scope to if it somehow does.
  const any = db.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string };
  db.prepare("UPDATE workspaces SET active = 1 WHERE id = ?").run(any.id);
  return any.id;
}

export function listWorkspaces(): Workspace[] {
  const rows = db.prepare("SELECT id, name, active FROM workspaces ORDER BY created_at ASC").all() as {
    id: string;
    name: string;
    active: number;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, active: !!r.active }));
}

export function createWorkspace(name: string): Workspace {
  const id = crypto.randomUUID();
  const trimmed = name.trim() || "New workspace";
  db.prepare("INSERT INTO workspaces (id, name, active, created_at) VALUES (?, ?, 0, ?)").run(
    id,
    trimmed,
    Date.now()
  );
  return { id, name: trimmed, active: false };
}

export function activateWorkspace(id: string): boolean {
  const exists = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(id);
  if (!exists) return false;
  db.prepare("UPDATE workspaces SET active = 0").run();
  db.prepare("UPDATE workspaces SET active = 1 WHERE id = ?").run(id);
  return true;
}

export function renameWorkspace(id: string, name: string): boolean {
  if (!name.trim()) return false;
  const res = db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name.trim(), id);
  return res.changes > 0;
}

export function deleteWorkspace(id: string): { ok: true } | { error: string } {
  const count = (db.prepare("SELECT COUNT(*) as c FROM workspaces").get() as { c: number }).c;
  if (count <= 1) return { error: "can't delete the only workspace" };
  const ws = db.prepare("SELECT active FROM workspaces WHERE id = ?").get(id) as
    | { active: number }
    | undefined;
  if (!ws) return { error: "workspace not found" };

  db.prepare("DELETE FROM traces WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM service_bindings WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);

  if (ws.active) {
    const next = db.prepare("SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as {
      id: string;
    };
    db.prepare("UPDATE workspaces SET active = 1 WHERE id = ?").run(next.id);
  }
  return { ok: true };
}

// --- Traces ---

export function listTraces(): TracePayload[] {
  const ws = activeWorkspaceId();
  const rows = db
    .prepare("SELECT payload FROM traces WHERE workspace_id = ? ORDER BY updated_at ASC")
    .all(ws) as { payload: string }[];
  return rows.map((r) => JSON.parse(r.payload));
}

// Multiple services in the same logical flow each flush their own buffered
// steps independently (see the capture SDK), so incoming payloads sharing a
// traceId are merged into one trace rather than kept as separate entries.
// Steps are re-sorted by timestamp so cross-service execution order is
// preserved even though they arrived in separate HTTP requests.
export function addTrace(incoming: TracePayload): TracePayload {
  const ws = activeWorkspaceId();
  const row = db.prepare("SELECT payload FROM traces WHERE trace_id = ?").get(incoming.traceId) as
    | { payload: string }
    | undefined;

  const merged: TracePayload = !row
    ? incoming
    : {
        traceId: incoming.traceId,
        steps: [...(JSON.parse(row.payload) as TracePayload).steps, ...incoming.steps].sort(
          (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
        ),
      };

  db.prepare(
    `INSERT INTO traces (trace_id, workspace_id, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(incoming.traceId, ws, JSON.stringify(merged), Date.now());

  // ponytail: cap instead of a real retention policy — recent traces are what
  // you're debugging with, ancient ones just bloat the db.
  db.prepare(
    `DELETE FROM traces WHERE workspace_id = ? AND trace_id NOT IN (
       SELECT trace_id FROM traces WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?
     )`
  ).run(ws, ws, MAX_TRACES_PER_WORKSPACE);

  return merged;
}

// --- UI state (which trace/step you were on) ---

export interface UiState {
  activeTraceId: string | null;
  stepIndex: number;
}

export function getUiState(): UiState {
  const ws = activeWorkspaceId();
  const row = db.prepare("SELECT active_trace_id, step_index FROM ui_state WHERE workspace_id = ?").get(ws) as
    | { active_trace_id: string | null; step_index: number }
    | undefined;
  return row ? { activeTraceId: row.active_trace_id, stepIndex: row.step_index } : { activeTraceId: null, stepIndex: 0 };
}

export function setUiState(patch: { activeTraceId?: string | null; stepIndex?: number }): UiState {
  const ws = activeWorkspaceId();
  const current = getUiState();
  const next: UiState = {
    activeTraceId: patch.activeTraceId !== undefined ? patch.activeTraceId : current.activeTraceId,
    stepIndex: patch.stepIndex !== undefined ? patch.stepIndex : current.stepIndex,
  };
  db.prepare(
    `INSERT INTO ui_state (workspace_id, active_trace_id, step_index) VALUES (?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET active_trace_id = excluded.active_trace_id, step_index = excluded.step_index`
  ).run(ws, next.activeTraceId, next.stepIndex);
  return next;
}

// --- Projects ---

function rowToProject(r: { id: string; name: string; dir: string; run_command: string | null }): Project {
  return { id: r.id, name: r.name, dir: r.dir, ...(r.run_command ? { runCommand: r.run_command } : {}) };
}

export function listProjects(): Project[] {
  const ws = activeWorkspaceId();
  const rows = db
    .prepare("SELECT id, name, dir, run_command FROM projects WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(ws) as { id: string; name: string; dir: string; run_command: string | null }[];
  return rows.map(rowToProject);
}

export function getServiceBindings(): ServiceBindings {
  const ws = activeWorkspaceId();
  const rows = db
    .prepare("SELECT service, project_id FROM service_bindings WHERE workspace_id = ?")
    .all(ws) as { service: string; project_id: string }[];
  return Object.fromEntries(rows.map((r) => [r.service, r.project_id]));
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
  db.prepare(
    "INSERT INTO projects (id, workspace_id, name, dir, run_command, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(project.id, activeWorkspaceId(), project.name, project.dir, runCommand ?? null, Date.now());
  return project;
}

// Not scoped to the active workspace — a project started before switching
// workspace should still be resolvable (e.g. to stop it) even while another
// workspace's projects are the ones showing in the UI.
export function getProject(id: string): Project | undefined {
  const row = db.prepare("SELECT id, name, dir, run_command FROM projects WHERE id = ?").get(id) as
    | { id: string; name: string; dir: string; run_command: string | null }
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function updateProject(id: string, patch: { name?: string; runCommand?: string }): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const name = patch.name?.trim() ? patch.name.trim() : existing.name;
  const runCommand = patch.runCommand !== undefined ? patch.runCommand.trim() || null : existing.runCommand ?? null;
  db.prepare("UPDATE projects SET name = ?, run_command = ? WHERE id = ?").run(name, runCommand, id);
  return getProject(id)!;
}

export function removeProject(id: string): boolean {
  const res = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  db.prepare("DELETE FROM service_bindings WHERE project_id = ?").run(id);
  return res.changes > 0;
}

export function bindService(service: string, projectId: string | null): boolean {
  const ws = activeWorkspaceId();
  if (projectId === null) {
    db.prepare("DELETE FROM service_bindings WHERE workspace_id = ? AND service = ?").run(ws, service);
    return true;
  }
  const exists = db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").get(projectId, ws);
  if (!exists) return false;
  db.prepare(
    `INSERT INTO service_bindings (workspace_id, service, project_id) VALUES (?, ?, ?)
     ON CONFLICT(workspace_id, service) DO UPDATE SET project_id = excluded.project_id`
  ).run(ws, service, projectId);
  return true;
}

export function resolveServiceRoot(service: string | undefined): string | null {
  if (!service) return null;
  const ws = activeWorkspaceId();
  const row = db
    .prepare(
      `SELECT p.dir as dir FROM service_bindings sb
       JOIN projects p ON p.id = sb.project_id
       WHERE sb.workspace_id = ? AND sb.service = ?`
    )
    .get(ws, service) as { dir: string } | undefined;
  return row ? row.dir : null;
}
