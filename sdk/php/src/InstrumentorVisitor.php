<?php

namespace TtdCapture;

use PhpParser\Node;
use PhpParser\Node\Expr\Closure;
use PhpParser\Node\Stmt\ClassMethod;
use PhpParser\Node\Stmt\Function_;
use PhpParser\Node\Stmt\Return_;
use PhpParser\NodeVisitorAbstract;

final class InstrumentorVisitor extends NodeVisitorAbstract
{
    /** @var array<int, array{0: int, 1: string}> byte offset -> text to splice in */
    public array $insertions = [];

    /**
     * Enclosing function/method/closure frames, innermost last — lets a
     * `return` statement attribute itself to whichever function it actually
     * belongs to (not an outer one it happens to be lexically nested under),
     * since push/pop timing follows the traverser's own depth-first order.
     * Each frame's entryOffset lets a return that turns out to *be* the
     * function's only statement (e.g. `function getPages(): array { return
     * [...]; }` — extremely common for one-line accessor-style methods) skip
     * inserting a second, identical record call right on top of the first.
     *
     * @var array<int, array{name: string, entryOffset: int|null}>
     */
    private array $stack = [];

    public function enterNode(Node $node)
    {
        if ($node instanceof Function_ || $node instanceof ClassMethod || $node instanceof Closure) {
            if ($node->stmts === null) return null; // abstract/interface method — no body to inject into

            $name = self::nameFor($node);
            $offset = isset($node->stmts[0])
                ? $node->stmts[0]->getAttribute('startFilePos')
                : $node->getAttribute('endFilePos'); // empty body — insert right before the closing `}`
            if (is_int($offset)) {
                $this->insertions[] = [$offset, self::recordCall($name, $node->getStartLine())];
            }

            $this->stack[] = ['name' => $name, 'entryOffset' => is_int($offset) ? $offset : null];
            return null;
        }

        // Capture locals again right before each explicit return — the entry
        // capture only ever sees parameters (get_defined_vars() runs before
        // anything else in the body), so this is the difference between
        // hovering a variable and seeing nothing vs. seeing what it actually
        // held by the time the function returned.
        if ($node instanceof Return_ && $this->stack !== []) {
            $offset = $node->getAttribute('startFilePos');
            $frame = $this->stack[count($this->stack) - 1];
            // Same offset as the entry capture means this return *is* the
            // function's first (and only) statement — recording it again
            // here would just duplicate the exact same call/line/vars.
            if (is_int($offset) && $offset !== $frame['entryOffset']) {
                $this->insertions[] = [$offset, self::recordCall($frame['name'], $node->getStartLine())];
            }
        }

        return null;
    }

    public function leaveNode(Node $node)
    {
        if (!($node instanceof Function_ || $node instanceof ClassMethod || $node instanceof Closure)) {
            return null;
        }
        if ($node->stmts === null) return null;

        $frame = array_pop($this->stack);
        $name = $frame['name'];

        // Best-effort "falls off the end without an explicit return" case —
        // only checks the body's last top-level statement, not full
        // control-flow reachability, so a function whose last statement is
        // e.g. an if/else where every branch already returns gets one extra
        // (harmless, unreachable) record call here. Not worth a real CFG
        // analysis for what's ultimately a debugging aid.
        $stmts = $node->stmts;
        $last = $stmts === [] ? null : $stmts[count($stmts) - 1];
        if (!($last instanceof Return_)) {
            $offset = $node->getAttribute('endFilePos');
            if (is_int($offset)) {
                $this->insertions[] = [$offset, self::recordCall($name, $node->getEndLine())];
            }
        }

        return null;
    }

    private static function nameFor(Node $node): string
    {
        return match (true) {
            $node instanceof Function_, $node instanceof ClassMethod => $node->name->toString(),
            default => '(closure)',
        };
    }

    private static function recordCall(string $name, int $line): string
    {
        $escapedName = addslashes($name);
        return "\\TtdCapture\\Recorder::record(__FILE__, {$line}, \"{$escapedName}\", get_defined_vars());";
    }
}
