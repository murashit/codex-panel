import type { Thread } from "../../../../domain/threads/model";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { activeThreadState, type ChatState } from "../state/root-reducer";
import { threadStreamItems } from "../state/thread-stream";
import { activeTurnId, chatTurnBusy, type PendingTurnStart, pendingTurnStart } from "./turn-state";

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  items: readonly ThreadStreamItem[];
  pendingTurnStart: PendingTurnStart | null;
}

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  const activeThread = activeThreadState(state);
  return {
    activeThreadId: activeThread?.id ?? null,
    activeTurnId: activeTurnId(state),
    busy: chatTurnBusy(state),
    listedThreads: state.threadList.listedThreads,
    items: threadStreamItems(state.threadStream),
    pendingTurnStart: pendingTurnStart(state),
  };
}
