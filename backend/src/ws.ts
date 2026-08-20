import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { addTrace } from "./store.js";
import { getAgentTraceId, registerAgent, unregisterAgent } from "./debugAgents.js";
import type { StepSnapshot } from "./types.js";

let wss: WebSocketServer | null = null;

export function attachWebSocketServer(server: Server): void {
  // Two logical channels (client UI at /ws, debug agents at /debug-ws) share
  // one http.Server. Attaching two `new WebSocketServer({ server, path })`
  // instances directly doesn't compose — only the first one actually
  // completes the handshake, the second always 400s (reproduced in
  // isolation, a real `ws` behavior, not an Express/routing issue here) — so
  // both are created with `noServer: true` and one 'upgrade' listener routes
  // by pathname to whichever instance matches.
  wss = new WebSocketServer({ noServer: true });
  const debugWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/ws") {
      wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit("connection", ws, req));
    } else if (pathname === "/debug-ws") {
      debugWss.handleUpgrade(req, socket, head, (ws) => debugWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  attachDebugAgentHandlers(debugWss);
}

export function broadcast(msg: unknown): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

// Relay channel for debug agents (sdk/node/src/debug-agent.ts) running
// inside real projects: they connect out to us, register their service
// name, and stream back logpoint hits, which become trace steps just like
// any other capture path — reusing the same trace/topology/pane UI.
function attachDebugAgentHandlers(debugWss: WebSocketServer): void {
  debugWss.on("connection", (ws) => {
    let service: string | null = null;

    ws.on("message", (raw) => {
      let msg: { type: string; service?: string } & Partial<StepSnapshot>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "hello" && msg.service) {
        service = msg.service;
        registerAgent(service, ws);
        return;
      }

      if (msg.type === "hit" && service) {
        const traceId = getAgentTraceId(service);
        if (!traceId) return;
        const merged = addTrace({
          traceId,
          steps: [
            {
              service,
              file: msg.file ?? "",
              line: msg.line ?? 0,
              function: msg.function,
              locals: msg.locals,
              timestamp: Date.now(),
            },
          ],
        });
        broadcast({ type: "trace", trace: merged });
      }
    });

    ws.on("close", () => {
      if (service) unregisterAgent(service, ws);
    });
  });
}
