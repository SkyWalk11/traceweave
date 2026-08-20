import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";

export interface HoverStepData {
  function?: string;
  inputs?: Record<string, unknown>;
  locals?: Record<string, unknown>;
}

// Hover-to-inspect: maps each editor's model to the step data (function
// name, inputs, locals) it's currently showing, so a single hover provider
// per language can look up "what's this identifier's value right now"
// without needing per-model providers.
const modelStepData = new WeakMap<editor.ITextModel, HoverStepData>();
const hoverProvidersRegistered = new Set<string>();

export function setModelStepData(model: editor.ITextModel, data: HoverStepData): void {
  modelStepData.set(model, data);
}

export function registerHoverProvider(monaco: Monaco, language: string): void {
  if (hoverProvidersRegistered.has(language)) return;
  hoverProvidersRegistered.add(language);

  monaco.languages.registerHoverProvider(language, {
    provideHover(model: editor.ITextModel, position: Position) {
      const data = modelStepData.get(model);
      const word = model.getWordAtPosition(position);
      if (!data || !word) return null;

      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );

      if (word.word === data.function) {
        return {
          range,
          contents: [
            { value: `**${word.word}()** — called with:` },
            { value: "```json\n" + JSON.stringify(data.inputs ?? {}, null, 2) + "\n```" },
          ],
        };
      }

      const vars = { ...data.inputs, ...data.locals };
      if (word.word in vars) {
        return {
          range,
          contents: [
            { value: `**${word.word}**` },
            { value: "```json\n" + JSON.stringify(vars[word.word], null, 2) + "\n```" },
          ],
        };
      }

      return null;
    },
  });
}
