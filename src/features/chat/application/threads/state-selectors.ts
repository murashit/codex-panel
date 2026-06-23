import type { Thread } from "../../../../domain/threads/model";
import { chatTurnBusy } from "../conversation/turn-state";
import type { ChatState } from "../state/root-reducer";
import { messageStreamIsEmpty } from "../state/message-stream";

export function activeThreadId(state: ChatState): string | null {
  return state.activeThread.id;
}

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state) || threadId === state.activeThread.id;
}

export function listedThreads(state: ChatState): readonly Thread[] {
  return state.threadList.listedThreads;
}

export function messageStreamItemsEmpty(state: ChatState): boolean {
  return messageStreamIsEmpty(state.messageStream);
}
