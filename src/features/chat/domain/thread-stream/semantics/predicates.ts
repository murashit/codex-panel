import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../items";

export function isCompletedTurnOutcomeDialogue(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { turnId: string } {
  return (
    item.kind === "dialogue" &&
    item.dialogueKind !== "user" &&
    !!item.turnId &&
    item.dialogueState === "completed" &&
    (item.executionState ?? "completed") === "completed"
  );
}

export function isCompletedPlanCandidate(item: ThreadStreamItem): boolean {
  return (
    item.kind === "dialogue" &&
    item.dialogueKind === "proposedPlan" &&
    (item.executionState ? item.executionState === "completed" : item.dialogueState === "completed")
  );
}

export function threadStreamIsAutoReviewDecision(item: ThreadStreamItem): boolean {
  if (item.kind !== "reviewResult" && item.kind !== "approvalResult") return false;
  const { provenance } = item;
  if (provenance?.source === "appServer" && provenance.channel === "notification") return provenance.event === "autoReview";
  if (provenance?.source === "panel" && provenance.channel === "notice") return provenance.reason === "parsedAutoReview";
  return false;
}
