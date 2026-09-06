import type { ThreadStreamDialogueItem, ThreadStreamItem } from "./items";
import { isCompletedPlanCandidate, isCompletedTurnOutcomeDialogue } from "./semantics/predicates";

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

export interface PlanImplementationTarget {
  itemId: string;
}

export function threadStreamSegmentsEmpty(stableItems: readonly ThreadStreamItem[], activeItems: readonly ThreadStreamItem[]): boolean {
  return stableItems.length === 0 && activeItems.length === 0;
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
