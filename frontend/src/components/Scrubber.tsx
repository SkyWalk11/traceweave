import { useStore } from "../store/useStore";
import { TracePicker } from "./TracePicker";

export function Scrubber() {
  const traces = useStore((s) => s.traces);
  const activeTraceIndex = useStore((s) => s.activeTraceIndex);
  const stepIndex = useStore((s) => s.stepIndex);
  const stepNext = useStore((s) => s.stepNext);
  const stepPrev = useStore((s) => s.stepPrev);
  const step = useStore((s) => s.activeStep());

  const total = traces[activeTraceIndex]?.steps?.length ?? 0;

  return (
    <div className="scrubber">
      <TracePicker />
      <button onClick={stepPrev} disabled={stepIndex <= 0}>
        ◀ Prev
      </button>
      <span>
        Step {total ? stepIndex + 1 : 0} / {total}
        {step ? ` — ${step.service}:${step.function ?? ""}` : ""}
      </span>
      <button onClick={stepNext} disabled={stepIndex >= total - 1}>
        Next ▶
      </button>
    </div>
  );
}
