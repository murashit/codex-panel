import type { ThreadStreamDialogueItem, ThreadStreamItem } from "./items";
import { isLocalSteerDialogueClientId } from "./local-dialogue-ids";

// Roles follow the supplied history only; explicit steers do not consume a prompt slot.
export function threadStreamUserRoles(items: readonly ThreadStreamItem[]): ("initiator" | "steer" | null)[] {
  const seenTurns = new Set<string>();
  return items.map((item) => {
    if (item.kind !== "dialogue" || item.dialogueKind !== "user") return null;
    if (item.provenance?.source === "localUser" && item.provenance.interaction === "steer") return "steer";
    if (!item.turnId) return "initiator";
    const seen = seenTurns.has(item.turnId);
    seenTurns.add(item.turnId);
    return isLocalSteerDialogueClientId(item.clientId) || seen ? "steer" : "initiator";
  });
}

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

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

export interface PlanImplementationTarget {
  itemId: string;
}

export function forkCandidatesFromItems(items: readonly ThreadStreamItem[]): readonly ForkCandidate[] {
  return [...lastTurnOutcomeItemsByTurn(items)].map(([turnId, item]) => ({ itemId: item.id, turnId }));
}

export function lastTurnOutcomeItemsByTurn(items: readonly ThreadStreamItem[]): Map<string, ThreadStreamDialogueItem> {
  const outcomes = new Map<string, ThreadStreamDialogueItem>();
  for (const item of items) {
    if (isCompletedTurnOutcomeDialogue(item)) outcomes.set(item.turnId, item);
  }
  return outcomes;
}

export function latestImplementablePlanTargetFromItems(items: readonly ThreadStreamItem[]): PlanImplementationTarget | null {
  const item = [...items].reverse().find(isCompletedPlanCandidate);
  return item ? { itemId: item.id } : null;
}
