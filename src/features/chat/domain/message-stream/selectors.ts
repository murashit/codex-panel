import type { MessageStreamItem } from "./items";
import { messageStreamSemanticClassifications } from "./semantics/classify";

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

export interface PlanImplementationTarget {
  itemId: string;
}

export interface MessageStreamItemsEmptySource {
  items: readonly MessageStreamItem[];
  stableItems?: readonly MessageStreamItem[] | undefined;
  activeItems?: readonly MessageStreamItem[] | undefined;
}

export function messageStreamItemsEmpty(source: MessageStreamItemsEmptySource): boolean {
  if (!source.stableItems && !source.activeItems) return source.items.length === 0;
  return messageStreamSegmentsEmpty(source.stableItems ?? [], source.activeItems ?? []);
}

export function messageStreamSegmentsEmpty(stableItems: readonly MessageStreamItem[], activeItems: readonly MessageStreamItem[]): boolean {
  return stableItems.length === 0 && activeItems.length === 0;
}

export function forkCandidatesFromItems(items: readonly MessageStreamItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const { item, capabilities } of messageStreamSemanticClassifications(items)) {
    if (!item.turnId || !capabilities.isTurnOutcome) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { itemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function latestImplementablePlanTargetFromItems(items: readonly MessageStreamItem[]): PlanImplementationTarget | null {
  const classification = [...messageStreamSemanticClassifications(items)].reverse().find((item) => item.capabilities.canImplementPlan);
  return classification ? { itemId: classification.item.id } : null;
}

export function isCompletedTurnOutcomeMessage(item: MessageStreamItem): boolean {
  return messageStreamSemanticClassifications([item])[0]?.capabilities.isTurnOutcome ?? false;
}
