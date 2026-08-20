## Traceweave — Project Specification (Distributed Time-Travel Debugger)

**Objective:** Build a web-based, multi-language (Node.js, Go, PHP) distributed debugger that uses a "Record & Replay" (Time-Travel) architecture. It will allow developers to trace cross-service data flows and step through code execution virtually without pausing live processes.

### 1. System Requirements

**Functional Requirements:**

- **Trace Ingestion:** The backend must accept HTTP POST requests containing JSON trace payloads from instrumented microservices.
- **Virtual Stepping:** The frontend must parse a trace payload and allow users to step forward/backward through a unified timeline of cross-service execution.
- **Source Code Sync:** The frontend must fetch local source files from the backend and display them using Monaco Editor.
- **State Inspection:** The UI must display local variables and function inputs for the currently active execution step.
- **Real-time Updates:** The backend must push newly recorded traces to the frontend via WebSockets.

**Non-Functional Requirements:**

- **Tech Stack:** 100% JavaScript/TypeScript (Node.js backend, React web frontend).
- **Performance:** Code loading and stepping must be instantaneous (sub-50ms) in the UI.
- **Architecture:** Non-blocking asynchronous data capture (no real OS thread locks).

### 2. Architecture & Tech Stack

| **Component**        | **Technology**                  | **Purpose**                                   |
| -------------------- | -------------------------------- | --------------------------------------------- |
| **Frontend Web App** | React, Vite                     | Browser-based user interface                  |
| **Code Viewer**      | `@monaco-editor/react`          | Renders syntax-highlighted code panes         |
| **State Management** | Zustand (or Redux)              | Manages the current step index and trace data |
| **Local Backend**    | Node.js, Express/Fastify        | Ingests traces, serves local source code      |
| **Real-time Comms**  | `ws`(WebSockets)                | Streams active traces to the web frontend     |
| **Capture SDKs**     | OpenTelemetry / Custom Wrappers | Captures function arguments and line numbers  |

### 3. System Data Flow

1. **Execution:** A user triggers an API request in their local microservices environment.
2. **Capture:** The custom SDK in each service (Node, Go, PHP) records function entry/exit, local variables, and line numbers. It bundles these into a "Step Snapshot."
3. **Propagation:** Standard OpenTelemetry W3C headers pass the `traceparent` ID between services to link all steps together.
4. **Ingestion:** Services asynchronously send their completed Step Snapshots to the Node.js backend (`POST /api/traces`).
5. **Broadcast:** The Node.js backend broadcasts the unified JSON trace array over WebSockets to the React frontend.
6. **Rendering:** The frontend maps the active step to a local file path, requests the file text from the backend (`GET /api/source?file=...`), and renders it in the Monaco Editor.
7. **Interaction:** The user clicks "Step Next." The UI increments the array index, loads the next file, and highlights the new line.

### 4. Implementation Plan (Phases for Agent Execution)

#### Phase 1: Core Backend & Data Structures

- Initialize a Node.js Express/Fastify server.
- Define the canonical JSON schema for a "Trace Payload" and "Step Snapshot" (TraceID, service name, file path, line number, variables).
- Create an ingestion endpoint (`POST /api/traces`) that stores incoming payloads in memory.
- Create a local file-reading endpoint (`GET /api/source?file=path/to/file`) with basic security (restrict to specific workspace directories).

#### Phase 2: WebSockets & React Scaffolding

- Attach a WebSocket server to the Node.js backend to broadcast trace data upon ingestion.
- Initialize a React app (via Vite).
- Implement the WebSocket client in React to listen for new trace data and store it in global state.

#### Phase 3: The Multi-Pane Editor UI

- Install `@monaco-editor/react`.
- Build a split-pane layout component:
  - **Pane A (Editor):** Displays source code fetched from the backend. Dynamically updates the `language`, `value`, and `line` props based on the active step.
  - **Pane B (Inspector):** A JSON tree viewer displaying `inputs` and `locals` for the active step.
- Build the Scrubber/Toolbar component with "Previous Step" and "Next Step" buttons that mutate the current step index in the global state.

#### Phase 4: Mock Data & Integration Testing

- Write a Node.js script that generates a mock distributed trace (simulating a Go service calling a PHP service) and POSTs it to the backend.
- Verify the frontend receives the trace via WebSockets, automatically fetches the dummy source files, and allows seamless step-by-step navigation through the mock data.

---

**Note:** this is the original design spec this project was built from. It doesn't reflect
every decision made along the way (e.g. trace propagation ended up using a simple
`x-ttd-trace-id` header instead of W3C `traceparent`, Go support was never built, and several
capture mechanisms beyond the original plan were added). See [README.md](README.md) for how
the project actually works today.
