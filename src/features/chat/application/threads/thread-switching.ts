import { chatTurnBusy } from "../conversation/turn-state";
import type { ChatState } from "../state/root-reducer";

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state) || threadId === state.activeThread.id;
}
