import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import type { Project } from "../types";

interface Props {
  project: Project;
  onClose: () => void;
}

export function ProjectLogsModal({ project, onClose }: Props) {
  const lines = useStore((s) => s.projectLogs[project.id]) ?? [];
  const status = useStore((s) => s.processStatuses[project.id]) ?? "stopped";
  const loadProjectLogs = useStore((s) => s.loadProjectLogs);
  const startProject = useStore((s) => s.startProject);
  const stopProject = useStore((s) => s.stopProject);
  const updateProject = useStore((s) => s.updateProject);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [editingCommand, setEditingCommand] = useState(false);
  const [commandDraft, setCommandDraft] = useState(project.runCommand ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjectLogs(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function saveName() {
    setError(null);
    try {
      await updateProject(project.id, { name: nameDraft });
      setRenaming(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveCommand() {
    setError(null);
    try {
      await updateProject(project.id, { runCommand: commandDraft });
      setEditingCommand(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {renaming ? (
            <form
              className="rename-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
              />
            </form>
          ) : (
            <span>
              <span className="project-rename-label" onDoubleClick={() => setRenaming(true)}>
                {project.name}
              </span>{" "}
              <button className="icon-btn small" title="Rename" onClick={() => setRenaming(true)}>
                ✎
              </button>{" "}
              — <span className={"status-dot " + status} /> {status}
            </span>
          )}
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="logs-body">
          {lines.length === 0 && <div className="logs-empty">No output yet.</div>}
          {lines.map((line, i) => (
            <div key={i} className="logs-line">
              {line}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          {status !== "running" && editingCommand ? (
            <form
              className="command-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveCommand();
              }}
            >
              <input
                autoFocus
                placeholder="Run command, e.g. npm run dev"
                value={commandDraft}
                onChange={(e) => setCommandDraft(e.target.value)}
                onBlur={saveCommand}
              />
            </form>
          ) : (
            <span className="run-command-display">
              <code>{project.runCommand || "(no run command set)"}</code>
              {status !== "running" && (
                <button className="icon-btn small" title="Edit run command" onClick={() => setEditingCommand(true)}>
                  ✎
                </button>
              )}
            </span>
          )}
          {status === "running" ? (
            <button onClick={() => stopProject(project.id)}>■ Stop</button>
          ) : (
            <button onClick={() => startProject(project.id)} disabled={!project.runCommand}>
              ▶ Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
