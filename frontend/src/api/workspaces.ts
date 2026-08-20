import { apiFetch, apiPatchJson, apiPostJson } from "./client";
import type { Workspace } from "../types";

interface WorkspacesResponse {
  workspaces: Workspace[];
}

export function fetchWorkspaces(): Promise<WorkspacesResponse> {
  return apiFetch<WorkspacesResponse>("/api/workspaces");
}

export function createWorkspaceApi(name: string, activate = true): Promise<WorkspacesResponse> {
  return apiPostJson("/api/workspaces", { name, activate });
}

export function activateWorkspaceApi(id: string): Promise<WorkspacesResponse> {
  return apiPostJson(`/api/workspaces/${id}/activate`, {});
}

export function renameWorkspaceApi(id: string, name: string): Promise<WorkspacesResponse> {
  return apiPatchJson(`/api/workspaces/${id}`, { name });
}

export function deleteWorkspaceApi(id: string): Promise<WorkspacesResponse> {
  return apiFetch<WorkspacesResponse>(`/api/workspaces/${id}`, { method: "DELETE" });
}
