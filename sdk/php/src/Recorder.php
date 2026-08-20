<?php

namespace TtdCapture;

// Called by every function/method the StreamWrapper instrumented. Reads
// $_SERVER fresh on every call (not cached) so that per-request headers are
// correctly reflected even under a persistent worker (Octane) that serves
// many requests per process — no per-request lifecycle hooking needed.
final class Recorder
{
    private const TRACE_HEADER = 'HTTP_X_TTD_TRACE_ID';

    // Fallback for calls with no incoming trace header (e.g. hit directly,
    // not via a service that propagates one) — one growing trace for the
    // whole worker process's life, same simplification used by the Node
    // SDK's debug-agent for its logpoint sessions.
    private static ?string $fallbackTraceId = null;

    // Public so a call site making an outgoing HTTP request to another
    // captured service can attach it as the x-ttd-trace-id header, the same
    // way the Node SDK does automatically for outgoing fetch/http.request —
    // PHP has no equivalent zero-edit hook for curl-based clients (Guzzle
    // included), so propagating across an outgoing call needs this one-line
    // addition at the call site instead.
    public static function currentTraceId(): string
    {
        return $_SERVER[self::TRACE_HEADER] ?? self::fallbackTraceId();
    }

    public static function record(string $file, int $line, string $function, array $params): void
    {
        $traceId = self::currentTraceId();

        $inputs = [];
        foreach ($params as $key => $value) {
            $inputs[$key] = self::snapshot($value);
        }

        $payload = [
            'traceId' => $traceId,
            'steps' => [[
                'service' => getenv('TTD_SERVICE_NAME') ?: 'unknown-service',
                'file' => $file,
                'line' => $line,
                'function' => $function,
                'inputs' => $inputs,
                'timestamp' => (int) (microtime(true) * 1000),
            ]],
        ];

        self::send($payload);
    }

    private static function fallbackTraceId(): string
    {
        if (self::$fallbackTraceId === null) {
            self::$fallbackTraceId = self::uuid();
        }
        return self::$fallbackTraceId;
    }

    private static function uuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    // Only the depth limit for plain data (arrays/stdClass) — a real class
    // instance collapses to a placeholder at any depth via the check below,
    // so raising this doesn't reopen the "walk a PDO connection/Eloquent
    // model" risk the cap exists for.
    private const MAX_SNAPSHOT_DEPTH = 6;

    // Every parameter is captured automatically (not opted into, unlike a
    // manual recordStep() call), so this will regularly see things that
    // were never meant to be "data": a PDO connection, an Eloquent model
    // with lazy relations, a closure, a resource. Keep scalars/arrays
    // (small, depth-capped); reduce anything else to a short placeholder
    // instead of walking it — cheaper, and avoids objects whose __toString
    // or property access has side effects / can throw.
    private static function snapshot(mixed $value, int $depth = 0): mixed
    {
        if ($value === null || is_scalar($value)) {
            return $value;
        }
        if (is_resource($value)) {
            return '[resource: ' . get_resource_type($value) . ']';
        }
        if ($value instanceof \Closure) {
            return '[Closure]';
        }
        if (is_object($value) && !($value instanceof \stdClass)) {
            // A plain stdClass (e.g. json_decode output) is close enough to
            // an array literal to walk safely; anything else is a real class
            // instance — identify it without touching its internals, at any
            // depth. Checked *before* the depth cap below (not after) so an
            // array of stdClass objects several levels deep (a normal
            // nested request/response body) doesn't hit the cap before ever
            // reaching this check.
            return '[' . get_class($value) . ']';
        }
        if ($depth >= self::MAX_SNAPSHOT_DEPTH) {
            return is_array($value) ? '[Array(' . count($value) . ')]' : '[Object]';
        }
        if ($value instanceof \stdClass) {
            $value = (array) $value;
        }
        $out = [];
        $i = 0;
        foreach ($value as $k => $v) {
            if (++$i > 20) break;
            $out[$k] = self::snapshot($v, $depth + 1);
        }
        return $out;
    }

    private static function send(array $payload): void
    {
        $apiUrl = getenv('TTD_API_URL') ?: 'http://localhost:4000';
        $json = json_encode($payload);
        if ($json === false) return; // never let a bad value crash the host app

        $ch = curl_init("$apiUrl/api/traces");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS => 1000,
            CURLOPT_CONNECTTIMEOUT_MS => 500,
        ]);
        @curl_exec($ch); // fire-and-forget — a debugger-connectivity blip must never affect the host app
        curl_close($ch);
    }
}

function record(string $file, int $line, string $function, array $params): void
{
    Recorder::record($file, $line, $function, $params);
}
