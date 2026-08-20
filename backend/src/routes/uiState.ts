import { Router } from "express";
import { getUiState, setUiState } from "../store.js";

export const uiStateRouter = Router();

// Which trace/step you were last looking at, per workspace — so re-opening
// the debugger (or switching back to a workspace) picks up where you left
// off instead of always landing on the newest trace at step 0.
uiStateRouter.get("/ui-state", (_req, res) => {
  res.json(getUiState());
});

uiStateRouter.patch("/ui-state", (req, res) => {
  const { activeTraceId, stepIndex } = req.body ?? {};
  res.json(setUiState({ activeTraceId, stepIndex }));
});
