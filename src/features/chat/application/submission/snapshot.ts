import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { activeThreadState, type ChatState } from "../state/model";
import { threadStreamItems } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import { activeTurnId, chatTurnBusy, type PendingTurnStart, pendingTurnStart } from "../turns/turn-state";

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  items: readonly ThreadStreamItem[];
  pendingTurnStart: PendingTurnStart | null;
}

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  const activeThread = activeThreadState(state);
  return {
    activeThreadId: activeThread?.id ?? null,
    activeTurnId: activeTurnId(state.activeTurn),
    busy: chatTurnBusy(state.activeTurn),
    items: threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)),
    pendingTurnStart: pendingTurnStart(state.activeTurn),
  };
}
