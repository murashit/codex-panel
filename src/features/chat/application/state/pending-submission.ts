import type { ThreadStreamDialogueItem } from "../../domain/thread-stream/items";

export interface ChatPendingSubmissionState {
  readonly id: string;
  readonly item: ThreadStreamDialogueItem;
  readonly targetThreadId: string | null;
}

export type PendingSubmissionAction =
  | { type: "web-submission/pending"; submission: ChatPendingSubmissionState }
  | { type: "web-submission/cancelled"; submissionId: string }
  | { type: "web-submission/steer-adopted"; submissionId: string; item: ThreadStreamDialogueItem };

export function pendingSubmissionMatches(
  state: {
    readonly pendingSubmission: ChatPendingSubmissionState | null;
    readonly activeThread: { readonly id: string | null };
  },
  submissionId: string,
): boolean {
  return state.pendingSubmission?.id === submissionId && state.pendingSubmission.targetThreadId === state.activeThread.id;
}
