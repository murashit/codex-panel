import type { MessageStreamItem } from "./items";
import { messageStreamSemanticClassifications } from "./semantics";

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

interface RollbackCandidateItem {
  turnId: string;
  itemId: string;
}

export function forkCandidatesFromItems(items: readonly MessageStreamItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const { item, actions } of messageStreamSemanticClassifications(items)) {
    if (!item.turnId || !actions.isTurnOutcome) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { itemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function latestImplementablePlanFromItems(items: readonly MessageStreamItem[]): MessageStreamItem | null {
  return [...messageStreamSemanticClassifications(items)].reverse().find((item) => item.actions.canImplementPlan)?.item ?? null;
}

export function isCompletedTurnOutcomeMessage(item: MessageStreamItem): boolean {
  return messageStreamSemanticClassifications([item])[0]?.actions.isTurnOutcome ?? false;
}

export function isForkCandidateItem(item: MessageStreamItem, candidates: readonly ForkCandidate[]): boolean {
  return candidates.some((candidate) => item.id === candidate.itemId && item.turnId === candidate.turnId);
}

export function isRollbackCandidateItem(item: MessageStreamItem, candidate: RollbackCandidateItem | null): boolean {
  return Boolean(
    candidate && item.kind === "message" && item.role === "user" && item.id === candidate.itemId && item.turnId === candidate.turnId,
  );
}
