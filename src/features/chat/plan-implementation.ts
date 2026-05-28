import { chatTurnBusy, type ChatState } from "./chat-state";
import type { DisplayItem } from "./display/types";

export function implementPlanCandidateFromState(
  state: Pick<ChatState, "activeThreadId" | "turnLifecycle" | "composerDraft" | "requestedCollaborationMode" | "displayItems">,
): DisplayItem | null {
  if (
    !state.activeThreadId ||
    chatTurnBusy(state) ||
    state.composerDraft.trim().length > 0 ||
    state.requestedCollaborationMode !== "plan"
  ) {
    return null;
  }
  return (
    [...state.displayItems].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ??
    null
  );
}
