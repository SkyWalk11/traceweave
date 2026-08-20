import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";

export const STEP_LIST_DEFAULT_WIDTH = 220;

interface Props {
  width: number;
}

function fileKey(service: string, file: string): string {
  return `${service}::${file}`;
}

export function StepList({ width }: Props) {
  const traces = useStore((s) => s.traces);
  const activeTraceIndex = useStore((s) => s.activeTraceIndex);
  const stepIndex = useStore((s) => s.stepIndex);
  const setStepIndex = useStore((s) => s.setStepIndex);
  const [query, setQuery] = useState("");
  const [fileFilter, setFileFilter] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const steps = traces[activeTraceIndex]?.steps ?? [];

  // Every distinct file touched by this trace, so you can pick exactly which
  // ones to track instead of scrolling past everything else — e.g. only the
  // service files you're actively debugging, not every framework/middleware
  // file that happened to get instrumented along the way.
  const distinctFiles = useMemo(() => {
    const seen = new Map<string, { service: string; file: string; count: number }>();
    for (const step of steps) {
      const key = fileKey(step.service, step.file);
      const entry = seen.get(key);
      if (entry) entry.count++;
      else seen.set(key, { service: step.service, file: step.file, count: 1 });
    }
    return [...seen.values()].sort((a, b) => a.service.localeCompare(b.service) || a.file.localeCompare(b.file));
  }, [steps]);

  if (steps.length === 0) return null;

  function toggleFile(key: string) {
    setFileFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = steps
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => fileFilter.size === 0 || fileFilter.has(fileKey(step.service, step.file)))
    .filter(
      ({ step }) =>
        !q ||
        step.service.toLowerCase().includes(q) ||
        (step.function ?? "").toLowerCase().includes(q) ||
        step.file.toLowerCase().includes(q) ||
        (step.file.split("/").pop() ?? "").toLowerCase().includes(q)
    );

  return (
    <div className="step-list" style={{ flex: `0 0 ${width}px` }}>
      <input
        className="step-list-search"
        type="text"
        placeholder="Search service, function, file…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <button className="step-list-filter-toggle" onClick={() => setFilterOpen((o) => !o)}>
        {filterOpen ? "▾" : "▸"} Files{fileFilter.size > 0 ? ` (${fileFilter.size})` : ""}
        {fileFilter.size > 0 && (
          <span
            className="step-list-filter-clear"
            onClick={(e) => {
              e.stopPropagation();
              setFileFilter(new Set());
            }}
          >
            clear
          </span>
        )}
      </button>

      {filterOpen && (
        <div className="step-list-file-checklist">
          {distinctFiles.map(({ service, file, count }) => {
            const key = fileKey(service, file);
            const slash = file.lastIndexOf("/");
            const basename = slash === -1 ? file : file.slice(slash + 1);
            const dir = slash === -1 ? "" : file.slice(0, slash);
            return (
              <label key={key} className="step-list-file-row" title={file}>
                <input type="checkbox" checked={fileFilter.has(key)} onChange={() => toggleFile(key)} />
                <span className="step-list-file-text">
                  <span className="step-list-file-basename">{basename}</span>
                  {dir && <span className="step-list-file-dir">{dir}</span>}
                </span>
                <span className="step-list-file-service">{service}</span>
                <span className="step-list-file-count">{count}</span>
              </label>
            );
          })}
        </div>
      )}

      <div className="step-list-items">
        {filtered.length === 0 && <div className="step-list-empty">No matching steps.</div>}
        {filtered.map(({ step, i }) => (
          <button
            key={i}
            className={"step-list-item" + (i === stepIndex ? " active" : "")}
            onClick={() => setStepIndex(i)}
          >
            <span className="step-list-index">{i + 1}</span>
            <span className="step-list-service">{step.service}</span>
            <span className="step-list-fn">{step.function ?? "(anonymous)"}</span>
            <span className="step-list-loc">
              {step.file}:{step.line}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
