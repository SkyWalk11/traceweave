import { create } from "zustand";
import { browseFolder, fetchSource } from "../api/source";
import { fetchTraces } from "../api/traces";
import { connectSocket } from "../api/socket";
import {
  createProject,
  deleteProject,
  fetchProjectLogs,
  fetchProjects,
  setServiceBinding,
  startProjectProcess,
  stopProjectProcess,
  updateProjectApi,
} from "../api/projects";
import { setBreakpoint as setBreakpointApi } from "../api/breakpoints";
import { sourceKey } from "../utils/sourceKey";
import { breakpointKey } from "../utils/breakpointKey";
import type { BrowseResult, ProcessStatus, Project, ServiceBindings, StepSnapshot, Trace } from "../types";

const MAX_LOG_LINES = 500;

interface StoreState {
  projects: Project[]; // registry of local folders, any number
  serviceBindings: ServiceBindings; // service name -> project id
  processStatuses: Record<string, ProcessStatus>; // project id -> status
  projectLogs: Record<string, string[]>; // project id -> buffered log lines
  traces: Trace[];
  activeTraceIndex: number;
  stepIndex: number;
  sourceCache: Record<string, string>; // `${service}:${file}` -> text
  breakpoints: Set<string>; // `${service}:${file}:${line}`, set via debug-agent logpoints

  connect(): void;
  toggleBreakpoint(service: string, file: string, line: number): Promise<void>;
  loadProjects(): Promise<void>;
  addProject(name: string, dir: string, runCommand?: string): Promise<Project>;
  updateProject(id: string, patch: { name?: string; runCommand?: string }): Promise<void>;
  removeProject(id: string): Promise<void>;
  bindService(service: string, projectId: string | null): Promise<void>;
  startProject(id: string): Promise<void>;
  stopProject(id: string): Promise<void>;
  loadProjectLogs(id: string): Promise<void>;
  browse(dir?: string): Promise<BrowseResult>;
  loadTraces(): Promise<void>;
  setActiveTrace(index: number): void;
  activeTrace(): Trace | null;
  activeStep(): StepSnapshot | null;
  loadActiveTraceSources(): Promise<void>;
  refetchServiceSources(service: string): Promise<void>;
  stepNext(): void;
  stepPrev(): void;
  setStepIndex(index: number): void;
}

export const useStore = create<StoreState>((set, get) => ({
  projects: [],
  serviceBindings: {},
  processStatuses: {},
  projectLogs: {},
  traces: [],
  activeTraceIndex: -1,
  stepIndex: 0,
  sourceCache: {},
  breakpoints: new Set(),

  async toggleBreakpoint(service, file, line) {
    const key = breakpointKey(service, file, line);
    const has = get().breakpoints.has(key);
    await setBreakpointApi(service, file, line, !has);
    set((s) => {
      const next = new Set(s.breakpoints);
      if (has) next.delete(key);
      else next.add(key);
      return { breakpoints: next };
    });
  },

  connect() {
    connectSocket({
      onTrace(trace) {
        set((s) => {
          const existingIndex = s.traces.findIndex((t) => t.traceId === trace.traceId);
          if (existingIndex !== -1) {
            // Same trace growing (another service flushed more steps) — update
            // it in place. Only clamp stepIndex if it's now out of range;
            // don't yank the user elsewhere if they're mid-review.
            const traces = s.traces.map((t, i) => (i === existingIndex ? trace : t));
            const stepIndex =
              existingIndex === s.activeTraceIndex
                ? Math.min(s.stepIndex, trace.steps.length - 1)
                : s.stepIndex;
            return { traces, stepIndex };
          }
          return {
            traces: [...s.traces, trace],
            activeTraceIndex: s.traces.length, // auto-follow newest trace
            stepIndex: 0,
          };
        });
        get().loadActiveTraceSources();
      },
      onLog(projectId, lines) {
        set((s) => {
          const merged = [...(s.projectLogs[projectId] ?? []), ...lines];
          const trimmed = merged.length > MAX_LOG_LINES ? merged.slice(-MAX_LOG_LINES) : merged;
          return { projectLogs: { ...s.projectLogs, [projectId]: trimmed } };
        });
      },
      onProcessStatus(projectId, status) {
        set((s) => ({ processStatuses: { ...s.processStatuses, [projectId]: status } }));
      },
    });
  },

  async loadProjects() {
    const { projects, serviceBindings, statuses } = await fetchProjects();
    set({ projects, serviceBindings: serviceBindings ?? {}, processStatuses: statuses ?? {} });
  },

  async addProject(name, dir, runCommand) {
    const { project, projects } = await createProject(name, dir, runCommand);
    set({ projects });
    return project;
  },

  async updateProject(id, patch) {
    const { projects } = await updateProjectApi(id, patch);
    set({ projects });
  },

  async removeProject(id) {
    const { projects, serviceBindings } = await deleteProject(id);
    set((s) => {
      const processStatuses = { ...s.processStatuses };
      delete processStatuses[id];
      const projectLogs = { ...s.projectLogs };
      delete projectLogs[id];
      return { projects, serviceBindings, sourceCache: {}, processStatuses, projectLogs };
    });
    get().loadActiveTraceSources();
  },

  async bindService(service, projectId) {
    const { serviceBindings } = await setServiceBinding(service, projectId);
    set({ serviceBindings });
    // Deliberately don't clear this service's cached source first: the pane
    // should keep showing the file it already had until the freshly-bound
    // project's version is fetched, not flash blank in between — and if the
    // fetch turns up nothing (e.g. the newly bound project doesn't have that
    // file), it should keep showing the last known-good content rather than
    // going blank forever.
    await get().refetchServiceSources(service);
  },

  async startProject(id) {
    await startProjectProcess(id);
    set((s) => ({ processStatuses: { ...s.processStatuses, [id]: "running" }, projectLogs: { ...s.projectLogs, [id]: [] } }));
  },

  async stopProject(id) {
    await stopProjectProcess(id);
    set((s) => ({ processStatuses: { ...s.processStatuses, [id]: "stopped" } }));
  },

  async loadProjectLogs(id) {
    const { lines } = await fetchProjectLogs(id);
    set((s) => ({ projectLogs: { ...s.projectLogs, [id]: lines } }));
  },

  browse(dir) {
    return browseFolder(dir);
  },

  async loadTraces() {
    const traces = await fetchTraces();
    set({ traces, activeTraceIndex: traces.length - 1, stepIndex: 0 });
    get().loadActiveTraceSources();
  },

  setActiveTrace(index) {
    set({ activeTraceIndex: index, stepIndex: 0 });
    get().loadActiveTraceSources();
  },

  activeTrace() {
    const { traces, activeTraceIndex } = get();
    return traces[activeTraceIndex] ?? null;
  },

  activeStep() {
    const { stepIndex } = get();
    return get().activeTrace()?.steps?.[stepIndex] ?? null;
  },

  // Fetch every source file touched by the active trace up front, so
  // stepping (and the multi-service pane view) never waits on a fetch.
  // Each file is fetched against the project bound to its service.
  async loadActiveTraceSources() {
    const trace = get().activeTrace();
    if (!trace) return;
    const { sourceCache } = get();
    const seen = new Set<string>();
    const targets = trace.steps.filter((s) => {
      const key = sourceKey(s.service, s.file);
      if (sourceCache[key] || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (targets.length === 0) return;

    const entries = await Promise.all(
      targets.map(async ({ service, file }) => {
        const text = await fetchSource(service, file);
        return text !== null ? ([sourceKey(service, file), text] as const) : null;
      })
    );
    set((s) => ({
      sourceCache: {
        ...s.sourceCache,
        ...Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null)),
      },
    }));
  },

  // Re-fetches every file the active trace has for one service, regardless
  // of what's already cached — used after rebinding that service to a
  // different project. Only ever adds/overwrites entries on success; never
  // deletes first, so a pane keeps showing its last content instead of
  // flashing blank while the new fetch is in flight (or forever, if the
  // newly bound project doesn't have that file at all).
  async refetchServiceSources(service) {
    const trace = get().activeTrace();
    if (!trace) return;
    const files = [...new Set(trace.steps.filter((s) => s.service === service).map((s) => s.file))];
    if (files.length === 0) return;

    const entries = await Promise.all(
      files.map(async (file) => {
        const text = await fetchSource(service, file);
        return text !== null ? ([sourceKey(service, file), text] as const) : null;
      })
    );
    set((s) => ({
      sourceCache: {
        ...s.sourceCache,
        ...Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null)),
      },
    }));
  },

  stepNext() {
    const { traces, activeTraceIndex, stepIndex } = get();
    const total = traces[activeTraceIndex]?.steps?.length ?? 0;
    if (stepIndex < total - 1) set({ stepIndex: stepIndex + 1 });
  },

  stepPrev() {
    const { stepIndex } = get();
    if (stepIndex > 0) set({ stepIndex: stepIndex - 1 });
  },

  setStepIndex(index) {
    const total = get().activeTrace()?.steps?.length ?? 0;
    if (index >= 0 && index < total) set({ stepIndex: index });
  },
}));
