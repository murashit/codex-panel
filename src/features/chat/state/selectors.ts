import { activeTurnId as selectActiveTurnId, chatTurnBusy, pendingTurnStart } from "./reducer";
import type {
  ChatActiveThreadState,
  ChatRuntimeState,
  ChatState,
  ChatMessageStreamState,
  ChatTurnState,
  PendingTurnStart,
} from "./reducer";
import type { Thread } from "../../../domain/threads/model";
import type { DisplayItem } from "../display/types";
import { messageStreamDisplayItems, messageStreamIsEmpty } from "./message-stream";

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  displayItems: readonly DisplayItem[];
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

export function displayItemsEmpty(state: ChatState): boolean {
  return messageStreamIsEmpty(state.messageStream);
}

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  return {
    activeThreadId: state.activeThread.id,
    activeTurnId: selectActiveTurnId(state),
    busy: chatTurnBusy(state),
    listedThreads: state.threadList.listedThreads,
    displayItems: messageStreamDisplayItems(state.messageStream),
    pendingTurnStart: pendingTurnStart(state),
  };
}

export function canImplementPlan(state: ChatState, item: DisplayItem): boolean {
  return item.id === implementPlanCandidateFromState(state)?.id;
}

export function implementPlanCandidateFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id">;
  turn: ChatTurnState;
  runtime: Pick<ChatRuntimeState, "selectedCollaborationMode">;
  messageStream: Pick<ChatMessageStreamState, "stableItems" | "activeSegment"> | Pick<ChatMessageStreamState, "displayItems">;
}): DisplayItem | null {
  if (!state.activeThread.id || chatTurnBusy(state) || state.runtime.selectedCollaborationMode !== "plan") {
    return null;
  }
  return (
    [...selectorDisplayItems(state.messageStream)]
      .reverse()
      .find((item) => item.kind === "message" && item.messageKind === "proposedPlan") ?? null
  );
}

function selectorDisplayItems(
  messageStream: Pick<ChatMessageStreamState, "stableItems" | "activeSegment"> | Pick<ChatMessageStreamState, "displayItems">,
): readonly DisplayItem[] {
  return "stableItems" in messageStream ? messageStreamDisplayItems(messageStream) : messageStream.displayItems;
}
