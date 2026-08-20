import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store/useStore";
import { computeServicePanes } from "./utils/computeServicePanes";
import { ProjectsBar } from "./components/ProjectsBar";
import { Scrubber } from "./components/Scrubber";
import { Topology } from "./components/Topology";
import { StepList, STEP_LIST_DEFAULT_WIDTH } from "./components/StepList";
import { ServicePane } from "./components/ServicePane";
import { PaneResizer, PANE_DEFAULT_WIDTH } from "./components/PaneResizer";
import "./App.css";

export default function App() {
  const connect = useStore((s) => s.connect);
  const loadProjects = useStore((s) => s.loadProjects);
  const loadTraces = useStore((s) => s.loadTraces);
  const traces = useStore((s) => s.traces);
  const activeTraceIndex = useStore((s) => s.activeTraceIndex);
  const stepIndex = useStore((s) => s.stepIndex);
  const projects = useStore((s) => s.projects);
  const serviceBindings = useStore((s) => s.serviceBindings);

  useEffect(() => {
    connect();
    loadProjects();
    loadTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trace = traces[activeTraceIndex] ?? null;
  const panes = useMemo(
    () => computeServicePanes(trace, stepIndex, projects, serviceBindings),
    [trace, stepIndex, projects, serviceBindings]
  );
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [stepListWidth, setStepListWidth] = useState(STEP_LIST_DEFAULT_WIDTH);

  return (
    <div className="app">
      <ProjectsBar />
      <Scrubber />
      <Topology panes={panes} />
      <div className="panes-row">
        {trace && trace.steps.length > 0 && (
          <>
            <StepList width={stepListWidth} />
            <PaneResizer width={stepListWidth} onWidthChange={setStepListWidth} minWidth={0} maxWidth={500} />
          </>
        )}
        <div className="panes">
          {panes.length === 0 && <div className="panes-empty">No trace loaded yet.</div>}
          {panes.map((pane, i) => (
            <div className={"pane-slot" + (i === panes.length - 1 ? " grow" : "")} key={pane.service}>
              <ServicePane
                pane={pane}
                width={widths[pane.service] ?? PANE_DEFAULT_WIDTH}
                grow={i === panes.length - 1}
              />
              {i < panes.length - 1 && (
                <PaneResizer
                  width={widths[pane.service] ?? PANE_DEFAULT_WIDTH}
                  onWidthChange={(w) => setWidths((prev) => ({ ...prev, [pane.service]: w }))}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
