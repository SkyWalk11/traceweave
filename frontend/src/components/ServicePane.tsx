import { useEffect, useMemo, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useStore } from "../store/useStore";
import { languageFor } from "../utils/language";
import { sourceKey } from "../utils/sourceKey";
import { basename } from "../utils/basename";
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
  const stepIndex = useStore((s) => s.stepIndex);
  const trace = useStore((s) => s.traces[s.activeTraceIndex]);
  const { service, step, reached, active } = pane;
  // The last pane grows to fill any leftover space so panes always cover
  // the full window width; earlier panes stay pinned to their dragged width.
  const flex = grow ? `1 1 ${width}px` : `0 0 ${width}px`;

  // Every distinct file this service has touched so far in the trace, in
  // visit order — these become the tabs. Derived from the (already
  // persisted) trace rather than tracked separately, so tabs "persist"
  // across reloads for free: reloading just re-derives the same list.
  const tabFiles = useMemo(() => {
    if (!trace) return [];
    const seen = new Set<string>();
    const files: string[] = [];
    for (const s of trace.steps) {
      if (s.service !== service || seen.has(s.file)) continue;
      seen.add(s.file);
      files.push(s.file);
    }
    return files;
  }, [trace, service]);

  // A manually-clicked tab "pins" the view to that file until the next
  // step navigation, which snaps back to following the current step's file
  // — same as how an IDE's own cursor movement overrides a manually opened
  // tab's scroll position.
  const [pinnedFile, setPinnedFile] = useState<string | null>(null);
  useEffect(() => {
    setPinnedFile(null);
  }, [stepIndex]);

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

  const displayFile = pinnedFile && tabFiles.includes(pinnedFile) ? pinnedFile : step.file;
  const isLiveFile = displayFile === step.file;
  const code = sourceCache[sourceKey(service, displayFile)] ?? "";

  const onMount: OnMount = (editor, monaco) => {
    registerHoverProvider(monaco, languageFor(displayFile));
    if (isLiveFile) {
      setModelStepData(editor.getModel()!, {
        function: step.function,
        inputs: step.inputs,
        locals: step.locals,
      });
      editor.revealLineInCenter(step.line);
    }

    const bpLines = [...breakpoints]
      .filter((key) => key.startsWith(`${service}:${displayFile}:`))
      .map((key) => Number(key.split(":").pop()));

    editor.deltaDecorations(
      [],
      [
        // Only the file the current step is actually in gets the "you are
        // here" line marker — a pinned-open historical tab has no such line.
        ...(isLiveFile
          ? [
              {
                range: new monaco.Range(step.line, 1, step.line, 1),
                options: { isWholeLine: true, className: "active-line" },
              },
            ]
          : []),
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
        toggleBreakpoint(service, displayFile, e.target.position.lineNumber);
      }
    });
  };

  return (
    <div className={"pane service-pane" + (active ? " active" : "")} style={{ flex }}>
      <div className="pane-header">
        <span>{service}</span>
        <span className="pane-file">{displayFile}</span>
        <ServiceProjectPicker service={service} />
      </div>
      {tabFiles.length > 1 && (
        <div className="pane-tabs">
          {tabFiles.map((file) => (
            <button
              key={file}
              className={"pane-tab" + (file === displayFile ? " active" : "") + (file === step.file ? " live" : "")}
              title={file}
              onClick={() => setPinnedFile(file === step.file ? null : file)}
            >
              {basename(file)}
            </button>
          ))}
        </div>
      )}
      <div className="pane-editor">
        <Editor
          key={`${service}-${displayFile}-${isLiveFile ? step.line : 0}`}
          height="100%"
          language={languageFor(displayFile)}
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
