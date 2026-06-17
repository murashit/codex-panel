import { activeTurnId as selectActiveTurnId, chatTurnBusy, pendingTurnStart } from "./root-reducer";
import type {
  ChatActiveThreadState,
  ChatRuntimeState,
  ChatState,
  ChatMessageStreamState,
  ChatTurnState,
  PendingTurnStart,
} from "./root-reducer";
import type { Thread } from "../../../../domain/threads/model";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { latestImplementablePlanFromItems } from "../../domain/message-stream/selectors";
import { messageStreamItems, messageStreamIsEmpty } from "./message-stream";

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  items: readonly MessageStreamItem[];
  pendingTurnStart: PendingTurnStart | null;
}

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

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  return {
    activeThreadId: state.activeThread.id,
    activeTurnId: selectActiveTurnId(state),
    busy: chatTurnBusy(state),
    listedThreads: state.threadList.listedThreads,
    items: messageStreamItems(state.messageStream),
    pendingTurnStart: pendingTurnStart(state),
  };
}

export function canImplementPlanItemId(state: ChatState, itemId: string): boolean {
  return itemId === implementPlanCandidateFromState(state)?.id;
}

export function implementPlanCandidateFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id">;
  turn: ChatTurnState;
  runtime: Pick<ChatRuntimeState, "selectedCollaborationMode">;
  messageStream: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">;
}): MessageStreamItem | null {
  if (!state.activeThread.id || chatTurnBusy(state) || state.runtime.selectedCollaborationMode !== "plan") {
    return null;
  }
  return latestImplementablePlanFromItems(messageStreamItems(state.messageStream));
}
