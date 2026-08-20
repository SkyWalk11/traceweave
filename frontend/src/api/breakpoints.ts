import { apiPostJson } from "./client";

export function setBreakpoint(service: string, file: string, line: number, enabled: boolean): Promise<{ ok: true }> {
  return apiPostJson("/api/breakpoints", { service, file, line, enabled });
}
