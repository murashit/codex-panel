import type { ThreadStreamItem } from "./items";
import { threadStreamSemanticClassifications } from "./semantics/classify";

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

export interface PlanImplementationTarget {
  itemId: string;
}

export interface ThreadStreamItemsEmptySource {
  items: readonly ThreadStreamItem[];
  stableItems?: readonly ThreadStreamItem[] | undefined;
  activeItems?: readonly ThreadStreamItem[] | undefined;
}

export function threadStreamItemsEmpty(source: ThreadStreamItemsEmptySource): boolean {
  if (!source.stableItems && !source.activeItems) return source.items.length === 0;
  return threadStreamSegmentsEmpty(source.stableItems ?? [], source.activeItems ?? []);
}

export function threadStreamSegmentsEmpty(stableItems: readonly ThreadStreamItem[], activeItems: readonly ThreadStreamItem[]): boolean {
  return stableItems.length === 0 && activeItems.length === 0;
}

export function forkCandidatesFromItems(items: readonly ThreadStreamItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const { item, capabilities } of threadStreamSemanticClassifications(items)) {
    if (!item.turnId || !capabilities.isTurnOutcome) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { itemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function latestImplementablePlanTargetFromItems(items: readonly ThreadStreamItem[]): PlanImplementationTarget | null {
  const classification = [...threadStreamSemanticClassifications(items)].reverse().find((item) => item.capabilities.canImplementPlan);
  return classification ? { itemId: classification.item.id } : null;
}

export function isCompletedTurnOutcomeDialogue(item: ThreadStreamItem): boolean {
  return threadStreamSemanticClassifications([item])[0]?.capabilities.isTurnOutcome ?? false;
}
