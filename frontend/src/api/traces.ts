import { apiFetch } from "./client";
import type { Trace } from "../types";

export function fetchTraces(): Promise<Trace[]> {
  return apiFetch<Trace[]>("/api/traces");
}
