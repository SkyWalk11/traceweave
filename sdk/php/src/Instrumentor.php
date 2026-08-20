<?php

namespace TtdCapture;

use PhpParser\NodeTraverser;
use PhpParser\ParserFactory;

final class Instrumentor
{
    // Splices the record call directly into the original source text at
    // exact byte offsets, rather than re-serializing the whole file through
    // PhpParser's PrettyPrinter — pretty-printing reformats everything
    // (collapses blank lines, restructures multi-line chains, drops
    // comments), which silently destroys line-number correspondence between
    // what's shown in the UI (the real file on disk) and what actually
    // executes. The live debug-agent (Xdebug) sets breakpoints by file:line
    // against the *executing* code, so that correspondence has to be exact.
    //
    // The trick that keeps every line number identical to the original: the
    // injected call is spliced in with no leading/trailing newline, sharing
    // whatever source line already contains the injection point (the start
    // of the function's first statement, or the closing `}` for an empty
    // body) — so no line is ever added or removed, only extended.
    public static function transform(string $source, string $file): string
    {
        $parser = (new ParserFactory())->createForNewestSupportedVersion();
        $ast = $parser->parse($source);
        if ($ast === null) return $source;

        $visitor = new InstrumentorVisitor();
        $traverser = new NodeTraverser();
        $traverser->addVisitor($visitor);
        $traverser->traverse($ast);

        if ($visitor->insertions === []) return $source;

        // Apply back-to-front: every offset was computed against the
        // *original* source, so later (higher-offset) insertions must land
        // first, before an earlier one shifts the string underneath them.
        usort($visitor->insertions, static fn (array $a, array $b) => $b[0] <=> $a[0]);

        $result = $source;
        foreach ($visitor->insertions as [$offset, $text]) {
            $result = substr($result, 0, $offset).$text.substr($result, $offset);
        }
        return $result;
    }
}
