import Editor, { type OnMount } from "@monaco-editor/react";
import { useStore } from "../store/useStore";
import { languageFor } from "../utils/language";
import { sourceKey } from "../utils/sourceKey";
import { registerHoverProvider, setModelStepData } from "../utils/monacoHover";
import { ServiceProjectPicker } from "./ServiceProjectPicker";
import { JsonView } from "./JsonView";
import type { ServicePaneData } from "../types";

interface Props {
  pane: ServicePaneData;
  width: number;
  grow: boolean;
}

export function ServicePane({ pane, width, grow }: Props) {
  const sourceCache = useStore((s) => s.sourceCache);
  const breakpoints = useStore((s) => s.breakpoints);
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint);
  const { service, step, reached, active } = pane;
  // The last pane grows to fill any leftover space so panes always cover
  // the full window width; earlier panes stay pinned to their dragged width.
  const flex = grow ? `1 1 ${width}px` : `0 0 ${width}px`;

  if (!reached || !step) {
    return (
      <div className="pane service-pane pending" style={{ flex }}>
        <div className="pane-header">
          <span>{service}</span>
          <ServiceProjectPicker service={service} />
        </div>
        <div className="pane-waiting">waiting…</div>
      </div>
    );
  }

  const code = sourceCache[sourceKey(service, step.file)] ?? "";

  const onMount: OnMount = (editor, monaco) => {
    registerHoverProvider(monaco, languageFor(step.file));
    setModelStepData(editor.getModel()!, {
      function: step.function,
      inputs: step.inputs,
      locals: step.locals,
    });
    editor.revealLineInCenter(step.line);

    const bpLines = [...breakpoints]
      .filter((key) => key.startsWith(`${service}:${step.file}:`))
      .map((key) => Number(key.split(":").pop()));

    editor.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(step.line, 1, step.line, 1),
          options: { isWholeLine: true, className: "active-line" },
        },
        ...bpLines.map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: { glyphMarginClassName: "breakpoint-glyph" },
        })),
      ]
    );

    // Real per-line/variable capture (see sdk/node/src/debug-agent.ts): click
    // the gutter to set a logpoint in the actual running process — no source
    // edits, and it doesn't block execution (captures, then auto-resumes).
    editor.updateOptions({ glyphMargin: true });
    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
        toggleBreakpoint(service, step.file, e.target.position.lineNumber);
      }
    });
  };

  return (
    <div className={"pane service-pane" + (active ? " active" : "")} style={{ flex }}>
      <div className="pane-header">
        <span>{service}</span>
        <span className="pane-file">{step.file}</span>
        <ServiceProjectPicker service={service} />
      </div>
      <div className="pane-editor">
        <Editor
          key={`${service}-${step.file}-${step.line}`}
          height="100%"
          language={languageFor(step.file)}
          theme="vs-dark"
          value={code}
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          onMount={onMount}
        />
      </div>
      <div className="pane-vars">
        <div className="pane-vars-label">Inputs</div>
        <JsonView data={step.inputs} />
        <div className="pane-vars-label">Locals</div>
        <JsonView data={step.locals} />
      </div>
    </div>
  );
}
