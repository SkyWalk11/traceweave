import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = process.env.TTD_DATA_DIR ?? path.resolve(import.meta.dirname, "../data");
fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DB_DIR, "traceweave.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dir TEXT NOT NULL,
    run_command TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_bindings (
    workspace_id TEXT NOT NULL,
    service TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, service)
  );
  CREATE TABLE IF NOT EXISTS traces (
    trace_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ui_state (
    workspace_id TEXT PRIMARY KEY,
    active_trace_id TEXT,
    step_index INTEGER NOT NULL DEFAULT 0
  );
`);

// First run: seed one workspace so every query that scopes by "the active
// workspace" always has something to find.
if (!db.prepare("SELECT id FROM workspaces LIMIT 1").get()) {
  db.prepare("INSERT INTO workspaces (id, name, active, created_at) VALUES (?, 'Default', 1, ?)").run(
    crypto.randomUUID(),
    Date.now()
  );
}
