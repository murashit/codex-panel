import { activeThreadId, activeThreadState, type ChatState } from "../state/model";
import { chatTurnBusy } from "../turns/turn-state";

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state.activeTurn) || threadId === activeThreadId(state) || activeThreadState(state)?.provenance?.kind === "subagent";
}
