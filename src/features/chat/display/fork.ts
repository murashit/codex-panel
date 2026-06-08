import type { DisplayItem } from "./types";
import { isCompletedTurnOutcomeMessage } from "./turn-outcome-message";

export interface ForkCandidate {
  itemId: string;
  turnId: string;
}

export function forkCandidatesFromItems(items: readonly DisplayItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const item of items) {
    if (!item.turnId || !isCompletedTurnOutcomeMessage(item)) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { itemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function isForkCandidateItem(item: DisplayItem, candidates: readonly ForkCandidate[]): boolean {
  return candidates.some((candidate) => item.id === candidate.itemId && item.turnId === candidate.turnId);
}

export function turnsAfterTurnId(items: readonly DisplayItem[], turnId: string): number | null {
  const turnIds = orderedTurnIds(items);
  const index = turnIds.indexOf(turnId);
  return index === -1 ? null : turnIds.length - index - 1;
}

function orderedTurnIds(items: readonly DisplayItem[]): string[] {
  const turnIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.turnId || seen.has(item.turnId)) continue;
    seen.add(item.turnId);
    turnIds.push(item.turnId);
  }
  return turnIds;
}
