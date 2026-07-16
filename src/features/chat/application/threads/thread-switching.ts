import { activeThreadId, type ChatState } from "../state/root-reducer";
import { chatTurnBusy } from "../turns/turn-state";

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state) || threadId === activeThreadId(state);
}
