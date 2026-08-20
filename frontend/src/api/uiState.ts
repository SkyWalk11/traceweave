import { apiFetch, apiPatchJson } from "./client";

export interface UiState {
  activeTraceId: string | null;
  stepIndex: number;
}

export function fetchUiState(): Promise<UiState> {
  return apiFetch<UiState>("/api/ui-state");
}

export function saveUiState(patch: Partial<UiState>): Promise<UiState> {
  return apiPatchJson<UiState>("/api/ui-state", patch);
}
