export interface StepSnapshot {
  service: string;
  file: string;
  line: number;
  function?: string;
  inputs?: Record<string, unknown>;
  locals?: Record<string, unknown>;
  timestamp?: number;
}

export interface TracePayload {
  traceId: string;
  steps: StepSnapshot[];
}

export interface Project {
  id: string;
  name: string;
  dir: string;
  runCommand?: string; // e.g. "npm run dev" — shell command, run with dir as cwd
}

export type ServiceBindings = Record<string, string>; // service name -> project id

export type ProcessStatus = "stopped" | "running" | "crashed";
