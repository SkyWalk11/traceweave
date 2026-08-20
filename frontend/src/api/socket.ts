import { API_URL } from "./client";
import type { ProcessStatus, Trace } from "../types";

export interface SocketHandlers {
  onTrace?: (trace: Trace) => void;
  onLog?: (projectId: string, lines: string[]) => void;
  onProcessStatus?: (projectId: string, status: ProcessStatus) => void;
}

export function connectSocket(handlers: SocketHandlers): WebSocket {
  const ws = new WebSocket(API_URL.replace("http", "ws") + "/ws");
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "trace":
        handlers.onTrace?.(msg.trace as Trace);
        break;
      case "log":
        handlers.onLog?.(msg.projectId, msg.lines);
        break;
      case "process-status":
        handlers.onProcessStatus?.(msg.projectId, msg.status);
        break;
    }
  };
  return ws;
}
