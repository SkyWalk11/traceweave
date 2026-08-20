import { apiFetch, apiPatchJson, apiPostJson } from "./client";
import type { Project, ProcessStatus, ServiceBindings } from "../types";

interface ProjectsResponse {
  projects: Project[];
  serviceBindings: ServiceBindings;
  statuses?: Record<string, ProcessStatus>;
}

export function fetchProjects(): Promise<ProjectsResponse> {
  return apiFetch<ProjectsResponse>("/api/projects");
}

export function createProject(
  name: string,
  dir: string,
  runCommand?: string
): Promise<{ project: Project; projects: Project[] }> {
  return apiPostJson("/api/projects", { name, dir, runCommand });
}

export function updateProjectApi(
  id: string,
  patch: { name?: string; runCommand?: string }
): Promise<{ project: Project; projects: Project[] }> {
  return apiPatchJson(`/api/projects/${id}`, patch);
}

export function deleteProject(id: string): Promise<ProjectsResponse> {
  return apiFetch<ProjectsResponse>(`/api/projects/${id}`, { method: "DELETE" });
}

export function setServiceBinding(
  service: string,
  projectId: string | null
): Promise<{ serviceBindings: ServiceBindings }> {
  return apiPostJson("/api/service-binding", { service, projectId });
}

export function startProjectProcess(id: string): Promise<{ ok: true }> {
  return apiPostJson(`/api/projects/${id}/start`, {});
}

export function stopProjectProcess(id: string): Promise<{ ok: true }> {
  return apiPostJson(`/api/projects/${id}/stop`, {});
}

export function fetchProjectLogs(id: string): Promise<{ lines: string[] }> {
  return apiFetch(`/api/projects/${id}/logs`);
}
