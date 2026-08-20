import { useState } from "react";
import { useStore } from "../store/useStore";

export function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces);
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = workspaces.find((w) => w.active);

  async function commitRename(id: string) {
    if (nameDraft.trim() && nameDraft.trim() !== workspaces.find((w) => w.id === id)?.name) {
      await renameWorkspace(id, nameDraft.trim());
    }
    setRenamingId(null);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    try {
      await createWorkspace(newName.trim());
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteWorkspace(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="workspace-switcher">
      <span className="workspace-label">Workspace:</span>
      {workspaces.map((w) =>
        renamingId === w.id ? (
          <form
            key={w.id}
            className="workspace-rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              commitRename(w.id);
            }}
          >
            <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => commitRename(w.id)} />
          </form>
        ) : (
          <span key={w.id} className={"workspace-chip" + (w.active ? " active" : "")}>
            <span
              onClick={() => !w.active && switchWorkspace(w.id)}
              onDoubleClick={() => {
                setRenamingId(w.id);
                setNameDraft(w.name);
              }}
              style={{ cursor: w.active ? "text" : "pointer" }}
            >
              {w.name}
            </span>
            {workspaces.length > 1 && (
              <button className="workspace-chip-remove" title="Delete workspace" onClick={() => remove(w.id)}>
                ✕
              </button>
            )}
          </span>
        )
      )}
      {creating ? (
        <form className="workspace-rename-form" onSubmit={submitCreate}>
          <input
            autoFocus
            placeholder="Workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => {
              if (!newName.trim()) setCreating(false);
            }}
          />
        </form>
      ) : (
        <button className="workspace-add" onClick={() => setCreating(true)}>
          + New
        </button>
      )}
      {error && <span className="error">{error}</span>}
      {!active && workspaces.length > 0 && <span className="error">no active workspace</span>}
    </div>
  );
}
