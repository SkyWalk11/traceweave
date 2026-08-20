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
import { fetchUiState, saveUiState } from "../api/uiState";
import {
  activateWorkspaceApi,
  createWorkspaceApi,
  deleteWorkspaceApi,
  fetchWorkspaces,
  renameWorkspaceApi,
} from "../api/workspaces";
import { sourceKey } from "../utils/sourceKey";
import { breakpointKey } from "../utils/breakpointKey";
import type { BrowseResult, ProcessStatus, Project, ServiceBindings, StepSnapshot, Trace, Workspace } from "../types";

const MAX_LOG_LINES = 500;

interface StoreState {
  workspaces: Workspace[]; // named, switchable groups of projects/bindings/traces
  projects: Project[]; // registry of local folders, any number, scoped to the active workspace
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
  loadWorkspaces(): Promise<void>;
  createWorkspace(name: string): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  renameWorkspace(id: string, name: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
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
  persistUiState(): void;
}

export const useStore = create<StoreState>((set, get) => ({
  workspaces: [],
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

  async loadWorkspaces() {
    const { workspaces } = await fetchWorkspaces();
    set({ workspaces });
  },

  async createWorkspace(name) {
    const { workspaces } = await createWorkspaceApi(name);
    set({ workspaces });
    // createWorkspaceApi activates the new (empty) workspace — reload
    // everything scoped to it so the UI doesn't keep showing the old one's
    // projects/traces.
    set({ projects: [], serviceBindings: {}, traces: [], activeTraceIndex: -1, stepIndex: 0, sourceCache: {} });
    await get().loadProjects();
    await get().loadTraces();
  },

  async switchWorkspace(id) {
    const { workspaces } = await activateWorkspaceApi(id);
    set({
      workspaces,
      projects: [],
      serviceBindings: {},
      traces: [],
      activeTraceIndex: -1,
      stepIndex: 0,
      sourceCache: {},
    });
    await get().loadProjects();
    await get().loadTraces();
  },

  async renameWorkspace(id, name) {
    const { workspaces } = await renameWorkspaceApi(id, name);
    set({ workspaces });
  },

  async deleteWorkspace(id) {
    const wasActive = get().workspaces.find((w) => w.id === id)?.active;
    const { workspaces } = await deleteWorkspaceApi(id);
    set({ workspaces });
    if (wasActive) {
      set({ projects: [], serviceBindings: {}, traces: [], activeTraceIndex: -1, stepIndex: 0, sourceCache: {} });
      await get().loadProjects();
      await get().loadTraces();
    }
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
        get().persistUiState();
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

  // Restores whichever trace/step you were last on (per workspace, saved in
  // the backend's sqlite db), instead of always jumping to the newest trace.
  async loadTraces() {
    const traces = await fetchTraces();
    const uiState = await fetchUiState().catch(() => ({ activeTraceId: null, stepIndex: 0 }));
    const restoredIndex = uiState.activeTraceId
      ? traces.findIndex((t) => t.traceId === uiState.activeTraceId)
      : -1;
    const activeTraceIndex = restoredIndex !== -1 ? restoredIndex : traces.length - 1;
    const total = traces[activeTraceIndex]?.steps?.length ?? 0;
    const stepIndex = restoredIndex !== -1 ? Math.min(Math.max(uiState.stepIndex, 0), Math.max(total - 1, 0)) : 0;
    set({ traces, activeTraceIndex, stepIndex });
    get().loadActiveTraceSources();
  },

  setActiveTrace(index) {
    set({ activeTraceIndex: index, stepIndex: 0 });
    get().loadActiveTraceSources();
    get().persistUiState();
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
    if (stepIndex < total - 1) {
      set({ stepIndex: stepIndex + 1 });
      get().persistUiState();
    }
  },

  stepPrev() {
    const { stepIndex } = get();
    if (stepIndex > 0) {
      set({ stepIndex: stepIndex - 1 });
      get().persistUiState();
    }
  },

  setStepIndex(index) {
    const total = get().activeTrace()?.steps?.length ?? 0;
    if (index >= 0 && index < total) {
      set({ stepIndex: index });
      get().persistUiState();
    }
  },

  // Fire-and-forget: saves which trace/step is active for the current
  // workspace, so reopening the debugger (or switching back to this
  // workspace) picks up where you left off.
  persistUiState() {
    const { traces, activeTraceIndex, stepIndex } = get();
    const activeTraceId = traces[activeTraceIndex]?.traceId ?? null;
    saveUiState({ activeTraceId, stepIndex }).catch(() => {});
  },
}));
