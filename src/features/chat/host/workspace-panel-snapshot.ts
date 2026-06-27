import type { ChatState } from "../application/state/root-reducer";
import type { ChatWorkspacePanelTurnLifecycle } from "./contracts";

export function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): ChatWorkspacePanelTurnLifecycle {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}
