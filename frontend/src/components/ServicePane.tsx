import { useMemo, useRef, useState } from "react";
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

  // A manually-clicked tab "pins" the view to that file — and, like a real
  // IDE tab, it stays pinned no matter what stepping happens elsewhere,
  // until you explicitly click a different tab (or click the live-marked
  // tab again to return to following it). An earlier version tried to
  // auto-reset this whenever the pane's own "current step" recomputed, but
  // that recompute happens on *every* global step-index change regardless
  // of which service you actually navigated through — stepping through
  // some other service could silently shift what counts as "this service's
  // current step" underneath you and blow the pin away for no reason
  // visible to the user.
  const [pinnedFile, setPinnedFile] = useState<string | null>(null);

  // Remembers the last real step this pane ever showed, so rewinding to
  // before this service's first occurrence (reached goes false) keeps
  // showing that last-known code/inputs/locals instead of blanking back to
  // "waiting…" — the same "don't erase what I've already seen" behavior as
  // a manually pinned tab, just automatic. Mutated directly during render
  // (not in an effect) so there's no one-render flash of the old value
  // before catching up.
  const lastKnownStep = useRef<typeof step>(null);
  if (step) lastKnownStep.current = step;
  const fallbackStep = reached ? step : lastKnownStep.current;

  const liveFile = reached ? (step?.file ?? null) : null;
  const displayFile = pinnedFile && tabFiles.includes(pinnedFile) ? pinnedFile : (fallbackStep?.file ?? null);
  const isLiveFile = displayFile !== null && displayFile === liveFile;

  // Nothing to show only when this service has never reached a step at all
  // (not even earlier in the trace) and nothing's been manually pinned.
  if (!displayFile) {
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

  const code = sourceCache[sourceKey(service, displayFile)] ?? "";

  const onMount: OnMount = (editor, monaco) => {
    registerHoverProvider(monaco, languageFor(displayFile));
    if (isLiveFile && step) {
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
        ...(isLiveFile && step
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
              className={"pane-tab" + (file === displayFile ? " active" : "") + (file === liveFile ? " live" : "")}
              title={file}
              onClick={() => setPinnedFile(file === liveFile ? null : file)}
            >
              {basename(file)}
            </button>
          ))}
        </div>
      )}
      <div className="pane-editor">
        <Editor
          key={`${service}-${displayFile}-${isLiveFile && step ? step.line : 0}`}
          height="100%"
          language={languageFor(displayFile)}
          theme="vs-dark"
          value={code}
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          onMount={onMount}
        />
      </div>
      <div className="pane-vars">
        {fallbackStep ? (
          <>
            {!reached && <div className="pane-vars-note">not reached at this step — showing last-known values</div>}
            <div className="pane-vars-label">Inputs</div>
            <JsonView data={fallbackStep.inputs} />
            <div className="pane-vars-label">Locals</div>
            <JsonView data={fallbackStep.locals} />
          </>
        ) : (
          <div className="pane-waiting">not reached at this step yet</div>
        )}
      </div>
    </div>
  );
}
