import { useStore } from "../store/useStore";

export function TracePicker() {
  const traces = useStore((s) => s.traces);
  const activeTraceIndex = useStore((s) => s.activeTraceIndex);
  const setActiveTrace = useStore((s) => s.setActiveTrace);

  if (traces.length === 0) return null;

  return (
    <select
      className="trace-picker"
      value={activeTraceIndex}
      onChange={(e) => setActiveTrace(Number(e.target.value))}
    >
      {traces.map((t, i) => (
        <option key={t.traceId} value={i}>
          {t.traceId} ({t.steps.length} steps)
        </option>
      ))}
    </select>
  );
}
