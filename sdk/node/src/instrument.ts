// Loaded via `--import ttd-capture/instrument` — injects a recordStep-style
// call at the start of every function in the target project's own files.
// Comprehensive, automatic capture with zero source edits, no V8
// breakpoints/pausing involved at all. Meant to run alongside
// `ttd-capture/auto`, which provides the per-request trace context
// (AsyncLocalStorage) and flush-on-response that the injected calls rely on.
//
// Line numbers need source-map translation, not a direct AST read: this
// hook runs *after* tsx's own hook in the load chain, so the `source` we
// receive and parse is already tsx's minified, single-physical-line output,
// not your original multi-line file — confirmed empirically while building
// this (every injected call reported "line 1" regardless of the real
// location). The fix reuses the exact same source-map machinery as
// debug-agent.ts, just in the opposite direction: that one translates
// original→generated to place a V8 breakpoint; this one translates
// generated→original (`originalPositionFor`) to report the real line.
//
// Uses `module.registerHooks` (synchronous, same-thread) rather than the
// older `module.register` (deprecated, runs hooks in a separate worker
// thread) — simpler and avoids cross-thread hook overhead.
import { registerHooks } from "node:module";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TraceMap, originalPositionFor, type SourceMapInput } from "@jridgewell/trace-mapping";

const PROJECT_ROOT = process.cwd();
const RUNTIME_SPECIFIER = "ttd-capture/instrument-runtime";
const RUNTIME_PATH = fileURLToPath(new URL("./instrument-runtime.js", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === RUNTIME_SPECIFIER) {
      return { url: pathToFileURL(RUNTIME_PATH).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!shouldInstrument(url)) return result;
    if (typeof result.source !== "string" && !(result.source instanceof Uint8Array)) return result;

    const source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
    try {
      return { ...result, source: instrument(source, url) };
    } catch (err) {
      console.error(`[ttd-capture] instrumentation failed for ${url}, loading it unmodified:`, err);
      return result;
    }
  },
});

function shouldInstrument(url: string): boolean {
  if (!url.startsWith("file://")) return false;
  const p = fileURLToPath(url);
  if (p === RUNTIME_PATH) return false; // never instrument ourselves — see resolve() above
  if (!p.startsWith(PROJECT_ROOT + path.sep)) return false;
  if (p.includes(`${path.sep}node_modules${path.sep}`)) return false;
  return /\.(ts|tsx|mts|js|mjs)$/.test(p);
}

// tsx/esbuild inline the source map as a base64 data URI comment at the end
// of the generated script — same extraction as debug-agent.ts.
function extractTracer(source: string): TraceMap | null {
  const match = source.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/);
  if (!match) return null;
  try {
    const json = Buffer.from(match[1], "base64").toString("utf8");
    return new TraceMap(JSON.parse(json) as SourceMapInput);
  } catch {
    return null;
  }
}

function instrument(source: string, url: string): string {
  const filePath = fileURLToPath(url);
  const relFile = path.relative(PROJECT_ROOT, filePath);
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".ts") || filePath.endsWith(".mts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

  const tracer = extractTracer(source);
  const sourceFile = ts.createSourceFile(relFile, source, ts.ScriptTarget.Latest, true, scriptKind);
  let injected = false;

  // Position info (needed for the line number) only survives on the
  // *original* node — ts.visitEachChild's reconstruction, once any
  // descendant changes, produces synthesized nodes whose positions are no
  // longer meaningful, so this has to be read before that call, not after.
  function resolveLine(node: ts.Node): number {
    const genPos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    if (!tracer) return genPos.line + 1;
    const original = originalPositionFor(tracer, { line: genPos.line + 1, column: genPos.character });
    return original.line ?? genPos.line + 1;
  }

  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (originalNode) => {
      const isMatch =
        isInstrumentableFunction(originalNode) && originalNode.body && ts.isBlock(originalNode.body);
      const line = isMatch ? resolveLine(originalNode) : 0;

      const node = ts.visitEachChild(originalNode, visit, context);

      if (isInstrumentableFunction(node) && node.body && ts.isBlock(node.body)) {
        const name = getFunctionName(node);
        const paramNames = node.parameters
          .filter((p): p is ts.ParameterDeclaration & { name: ts.Identifier } => ts.isIdentifier(p.name))
          .map((p) => p.name.text);

        const call = ts.factory.createExpressionStatement(
          ts.factory.createCallExpression(ts.factory.createIdentifier("__ttdRecordCall"), undefined, [
            ts.factory.createStringLiteral(relFile),
            ts.factory.createNumericLiteral(line),
            ts.factory.createStringLiteral(name),
            ts.factory.createObjectLiteralExpression(
              paramNames.map((n) => ts.factory.createShorthandPropertyAssignment(n)),
              false
            ),
          ])
        );

        injected = true;
        const newBody = ts.factory.updateBlock(node.body, [call, ...node.body.statements]);
        return updateFunctionBody(node, newBody);
      }

      return node;
    };
    return (rootNode) => ts.visitNode(rootNode, visit) as ts.SourceFile;
  };

  const result = ts.transform(sourceFile, [transformerFactory]);
  const printer = ts.createPrinter({ removeComments: false });
  const output = printer.printFile(result.transformed[0]);
  result.dispose();

  if (!injected) return source; // nothing to instrument — skip the import overhead

  return `import { __ttdRecordCall } from ${JSON.stringify(RUNTIME_SPECIFIER)};\n${output}`;
}

type InstrumentableFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isInstrumentableFunction(node: ts.Node): node is InstrumentableFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function getFunctionName(node: InstrumentableFunction): string {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
    return node.name.getText();
  }
  // Expressions/arrows assigned to a name: `const foo = () => {}`, `{ foo: () => {} }`.
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return "(anonymous)";
}

function updateFunctionBody(node: InstrumentableFunction, newBody: ts.Block): InstrumentableFunction {
  if (ts.isFunctionDeclaration(node)) {
    return ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      newBody
    );
  }
  if (ts.isFunctionExpression(node)) {
    return ts.factory.updateFunctionExpression(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      newBody
    );
  }
  if (ts.isArrowFunction(node)) {
    return ts.factory.updateArrowFunction(
      node,
      node.modifiers,
      node.typeParameters,
      node.parameters,
      node.type,
      node.equalsGreaterThanToken,
      newBody
    );
  }
  return ts.factory.updateMethodDeclaration(
    node,
    node.modifiers,
    node.asteriskToken,
    node.name,
    node.questionToken,
    node.typeParameters,
    node.parameters,
    node.type,
    newBody
  );
}
