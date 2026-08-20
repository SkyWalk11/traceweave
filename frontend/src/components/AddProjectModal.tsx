import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";

interface Props {
  onClose: () => void;
  onAdd: (name: string, dir: string, runCommand?: string) => Promise<void>;
}

// Browses the local filesystem and lets the user pick a folder + name it,
// registering it as a new entry in the Projects list.
export function AddProjectModal({ onClose, onAdd }: Props) {
  const browse = useStore((s) => s.browse);
  const [dir, setDir] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [runCommand, setRunCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pathInput, setPathInput] = useState("");

  async function go(target?: string) {
    try {
      const data = await browse(target);
      setDir(data.dir);
      setParent(data.parent);
      setFolders(data.folders);
      setFilter("");
      setPathInput(data.dir);
      if (!name) setName(data.dir.split("/").pop() ?? data.dir);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    go(undefined); // start at home dir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crumbs = dir ? dir.split("/").filter(Boolean) : [];
  const visibleFolders = filter.trim()
    ? folders.filter((f) => f.toLowerCase().includes(filter.trim().toLowerCase()))
    : folders;

  async function add() {
    if (!dir) return;
    setError(null);
    try {
      await onAdd(name || dir.split("/").pop() || dir, dir, runCommand.trim() || undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Add a project folder</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="breadcrumbs">
          <button onClick={() => go("/")}>/</button>
          {crumbs.map((part, i) => (
            <button key={i} onClick={() => go("/" + crumbs.slice(0, i + 1).join("/"))}>
              {part}
            </button>
          ))}
        </div>

        <form
          className="path-jump"
          onSubmit={(e) => {
            e.preventDefault();
            if (pathInput.trim()) go(pathInput.trim());
          }}
        >
          <input
            className="project-name-input"
            placeholder="Type or paste an absolute path…"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
          />
          <button type="submit">Go</button>
        </form>

        {error && <div className="error">{error}</div>}

        <input
          className="project-name-input folder-filter"
          placeholder="Filter folders…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="folder-list">
          {parent && parent !== dir && (
            <div className="folder-row" onClick={() => go(parent)}>
              .. (up)
            </div>
          )}
          {visibleFolders.map((f) => (
            <div key={f} className="folder-row" onClick={() => go(`${dir}/${f}`)}>
              📁 {f}
            </div>
          ))}
          {visibleFolders.length === 0 && (
            <div className="folder-row empty">{folders.length === 0 ? "No subfolders" : "No matches"}</div>
          )}
        </div>

        <div className="project-footer-inputs">
          <input
            className="project-name-input"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="project-name-input"
            placeholder="Run command (optional, e.g. npm run dev)"
            value={runCommand}
            onChange={(e) => setRunCommand(e.target.value)}
          />
        </div>
        <div className="modal-footer project-footer">
          <code>{dir}</code>
          <button disabled={!dir} onClick={add}>
            Add project
          </button>
        </div>
      </div>
    </div>
  );
}
