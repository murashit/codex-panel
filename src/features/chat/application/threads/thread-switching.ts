import type { ChatState } from "../state/root-reducer";
import { chatTurnBusy } from "../turns/turn-state";

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state) || threadId === state.activeThread.id;
}
