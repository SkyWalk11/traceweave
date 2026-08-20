import express from "express";
import { tracesRouter } from "./routes/traces.js";
import { projectsRouter } from "./routes/projects.js";
import { browseRouter } from "./routes/browse.js";
import { sourceRouter } from "./routes/source.js";
import { breakpointsRouter } from "./routes/breakpoints.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { uiStateRouter } from "./routes/uiState.js";
import { attachWebSocketServer } from "./ws.js";

const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/api", tracesRouter);
app.use("/api", projectsRouter);
app.use("/api", browseRouter);
app.use("/api", sourceRouter);
app.use("/api", breakpointsRouter);
app.use("/api", workspacesRouter);
app.use("/api", uiStateRouter);

const server = app.listen(PORT, () => console.log(`backend listening on :${PORT}`));
attachWebSocketServer(server);
