import crypto from "node:crypto";
import type { WebSocket } from "ws";

// Multiple debug-agent connections *can* register under the same service
// name — e.g. `tsx watch` runs as a supervisor process plus an actual worker
// process, and since NODE_OPTIONS is inherited by both, both load the debug
// agent. Only one of them ever actually executes the app's code, so
// breakpoint commands are broadcast to every connection under a service
// name rather than picking (and possibly guessing wrong) just one.
const connectionsByService = new Map<string, Set<WebSocket>>();
const traceIdByService = new Map<string, string>();

export function registerAgent(service: string, ws: WebSocket): void {
  if (!connectionsByService.has(service)) connectionsByService.set(service, new Set());
  connectionsByService.get(service)!.add(ws);
  if (!traceIdByService.has(service)) traceIdByService.set(service, crypto.randomUUID());
}

export function unregisterAgent(service: string, ws: WebSocket): void {
  connectionsByService.get(service)?.delete(ws);
}

export function getAgentTraceId(service: string): string | undefined {
  return traceIdByService.get(service);
}

export function setBreakpoint(service: string, file: string, line: number): boolean {
  const conns = connectionsByService.get(service);
  if (!conns || conns.size === 0) return false;
  const msg = JSON.stringify({ type: "set-breakpoint", file, line });
  for (const ws of conns) ws.send(msg);
  return true;
}

export function removeBreakpoint(service: string, file: string, line: number): boolean {
  const conns = connectionsByService.get(service);
  if (!conns || conns.size === 0) return false;
  const msg = JSON.stringify({ type: "remove-breakpoint", file, line });
  for (const ws of conns) ws.send(msg);
  return true;
}
