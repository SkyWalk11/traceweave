<?php

namespace GuzzleHttp\Handler;

// Zero-edit trace propagation for outgoing Guzzle requests (what Laravel's
// Http facade, and most PHP HTTP clients, use under the hood) — the PHP
// equivalent of how the Node SDK patches http.request at the prototype
// level.
//
// Guzzle's CurlFactory calls curl_setopt_array() *unqualified*, unlike every
// other curl_* call it makes (all of which are `\`-qualified). PHP resolves
// an unqualified function call by checking the current namespace first,
// then falling back to the global one — so defining our own
// GuzzleHttp\Handler\curl_setopt_array() here gets called instead, letting
// us inject the trace header into the outgoing request's headers before
// handing off to the real global function.
//
// This is inherently coupled to Guzzle's current internals: if a future
// Guzzle version fully-qualifies that call too, this silently stops firing
// (falls back to whatever manual header propagation exists at the call
// site) rather than breaking anything.
if (!function_exists(__NAMESPACE__.'\\curl_setopt_array')) {
    function curl_setopt_array($handle, array $options)
    {
        if (isset($options[CURLOPT_HTTPHEADER]) && class_exists(\TtdCapture\Recorder::class)) {
            $options[CURLOPT_HTTPHEADER][] = 'x-ttd-trace-id: '.\TtdCapture\Recorder::currentTraceId();
        }

        return \curl_setopt_array($handle, $options);
    }
}
