import { useState } from "react";
import { useStore } from "../store/useStore";
import { AddProjectModal } from "./AddProjectModal";

const ADD_NEW = "__add_new__";

interface Props {
  service: string;
}

export function ServiceProjectPicker({ service }: Props) {
  const projects = useStore((s) => s.projects);
  const serviceBindings = useStore((s) => s.serviceBindings);
  const bindService = useStore((s) => s.bindService);
  const addProject = useStore((s) => s.addProject);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boundId = serviceBindings[service] ?? "";

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === ADD_NEW) {
      setModalOpen(true);
      return;
    }
    setError(null);
    try {
      await bindService(service, value || null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(name: string, dir: string) {
    const project = await addProject(name, dir);
    await bindService(service, project.id);
    setModalOpen(false);
  }

  return (
    <span className="service-folder">
      <select className="service-folder-btn" value={boundId} onChange={onChange}>
        <option value="">unassigned</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add project…</option>
      </select>
      {error && <span className="error">{error}</span>}
      {modalOpen && <AddProjectModal onClose={() => setModalOpen(false)} onAdd={add} />}
    </span>
  );
}
