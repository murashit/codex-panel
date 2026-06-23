import type { Thread } from "../../../../domain/threads/model";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { activeTurnId, chatTurnBusy, pendingTurnStart, type PendingTurnStart } from "./turn-state";
import type { ChatState } from "../state/root-reducer";
import { messageStreamItems } from "../state/message-stream";

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  items: readonly MessageStreamItem[];
  pendingTurnStart: PendingTurnStart | null;
}

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  return {
    activeThreadId: state.activeThread.id,
    activeTurnId: activeTurnId(state),
    busy: chatTurnBusy(state),
    listedThreads: state.threadList.listedThreads,
    items: messageStreamItems(state.messageStream),
    pendingTurnStart: pendingTurnStart(state),
  };
}
