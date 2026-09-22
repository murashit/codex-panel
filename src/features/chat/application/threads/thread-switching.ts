import { activeThreadId, activeThreadState, type ChatState } from "../state/model";
import { chatTurnBusy } from "../turns/turn-state";

export function canSwitchToThread(state: ChatState, threadId: string | null): boolean {
  if (threadId !== null && threadId === activeThreadId(state)) return true;
  if (state.pendingSubmission || (state.panelThread.kind === "fork-draft" && state.panelThread.operation === "creating")) return false;
  return !chatTurnBusy(state.activeTurn) || activeThreadState(state)?.provenance?.kind === "subagent";
}
