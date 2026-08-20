<?php

namespace TtdCapture;

use PhpParser\Node;
use PhpParser\Node\Expr\Closure;
use PhpParser\Node\Stmt\ClassMethod;
use PhpParser\Node\Stmt\Function_;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;
use PhpParser\PrettyPrinter;

final class Instrumentor
{
    public static function transform(string $source, string $file): string
    {
        $parser = (new ParserFactory())->createForNewestSupportedVersion();
        $ast = $parser->parse($source);
        if ($ast === null) return $source;

        $traverser = new NodeTraverser();
        $traverser->addVisitor(new class ($file) extends NodeVisitorAbstract {
            public function __construct(private string $file) {}

            public function enterNode(Node $node)
            {
                if (!($node instanceof Function_ || $node instanceof ClassMethod || $node instanceof Closure)) {
                    return null;
                }
                if ($node->stmts === null) return null; // abstract/interface method — no body to inject into

                $name = match (true) {
                    $node instanceof Function_, $node instanceof ClassMethod => $node->name->toString(),
                    default => '(closure)',
                };

                $recordCall = new Node\Stmt\Expression(new Node\Expr\FuncCall(
                    new Node\Name\FullyQualified('TtdCapture\\Recorder::record'),
                    [
                        new Node\Arg(new Node\Scalar\MagicConst\File()),
                        new Node\Arg(new Node\Scalar\Int_($node->getStartLine())),
                        new Node\Arg(new Node\Scalar\String_($name)),
                        new Node\Arg(new Node\Expr\FuncCall(new Node\Name('get_defined_vars'))),
                    ]
                ));

                array_unshift($node->stmts, $recordCall);
                return null;
            }
        });

        $transformed = $traverser->traverse($ast);
        return (new PrettyPrinter\Standard())->prettyPrintFile($transformed);
    }
}
