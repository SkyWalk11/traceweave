export interface StepSnapshot {
  service: string;
  file: string;
  line: number;
  function?: string;
  inputs?: Record<string, unknown>;
  locals?: Record<string, unknown>;
  timestamp?: number;
}

export interface Trace {
  traceId: string;
  steps: StepSnapshot[];
}

export interface Project {
  id: string;
  name: string;
  dir: string;
  runCommand?: string;
}

export type ServiceBindings = Record<string, string>; // service name -> project id

export interface Workspace {
  id: string;
  name: string;
  active: boolean;
}

export type ProcessStatus = "stopped" | "running" | "crashed";

export interface BrowseResult {
  dir: string;
  parent: string;
  folders: string[];
}

// Derived per-service view for the topology/pane UI — not part of the wire
// protocol, computed client-side from a Trace + the current step index.
export interface ServicePaneData {
  service: string;
  active: boolean;
  reached: boolean;
  step: StepSnapshot | null;
}
