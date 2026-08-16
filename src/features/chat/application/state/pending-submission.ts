import type { ThreadStreamDialogueItem } from "../../domain/thread-stream/items";

export interface ChatPendingSubmissionState {
  readonly id: string;
  readonly item: ThreadStreamDialogueItem;
  readonly targetThreadId: string | null;
  readonly phase: "cancellable" | "committed";
}

export function pendingSubmissionMatches(
  state: {
    readonly pendingSubmission: ChatPendingSubmissionState | null;
    readonly activeThreadId: string | null;
  },
  submissionId: string,
): boolean {
  return state.pendingSubmission?.id === submissionId && state.pendingSubmission.targetThreadId === state.activeThreadId;
}

export function cancellablePendingSubmissionMatches(
  state: {
    readonly pendingSubmission: ChatPendingSubmissionState | null;
    readonly activeThreadId: string | null;
  },
  submissionId: string,
): boolean {
  return pendingSubmissionMatches(state, submissionId) && state.pendingSubmission?.phase === "cancellable";
}
