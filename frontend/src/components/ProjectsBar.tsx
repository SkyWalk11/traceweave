import { useState } from "react";
import { useStore } from "../store/useStore";
import { AddProjectModal } from "./AddProjectModal";
import { ProjectLogsModal } from "./ProjectLogsModal";
import type { Project } from "../types";

function ProjectChip({ project }: { project: Project }) {
  const status = useStore((s) => s.processStatuses[project.id]) ?? "stopped";
  const removeProject = useStore((s) => s.removeProject);
  const startProject = useStore((s) => s.startProject);
  const [logsOpen, setLogsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    try {
      await removeProject(project.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quickStart(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await startProject(project.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <span className="project-chip" title={project.dir}>
        {project.runCommand && <span className={"status-dot " + status} />}
        <span onClick={() => setLogsOpen(true)} style={{ cursor: "pointer" }}>
          {project.name}
        </span>
        {project.runCommand && status !== "running" && (
          <button className="project-chip-run" onClick={quickStart} title={`Run: ${project.runCommand}`}>
            ▶
          </button>
        )}
        <button className="project-chip-remove" onClick={remove}>
          ✕
        </button>
      </span>
      {error && <span className="error">{error}</span>}
      {logsOpen && <ProjectLogsModal project={project} onClose={() => setLogsOpen(false)} />}
    </>
  );
}

export function ProjectsBar() {
  const projects = useStore((s) => s.projects);
  const addProject = useStore((s) => s.addProject);
  const [modalOpen, setModalOpen] = useState(false);

  async function add(name: string, dir: string, runCommand?: string) {
    await addProject(name, dir, runCommand);
    setModalOpen(false);
  }

  return (
    <div className="projects-bar">
      <span className="label">Projects:</span>
      {projects.map((p) => (
        <ProjectChip key={p.id} project={p} />
      ))}
      {projects.length === 0 && <span className="workspace-path empty">none added yet</span>}
      <button onClick={() => setModalOpen(true)}>+ Add project</button>
      {modalOpen && <AddProjectModal onClose={() => setModalOpen(false)} onAdd={add} />}
    </div>
  );
}
