import { isCompletedTurnOutcomeMessage } from "./predicates";
import type { DisplayItem, MessageDisplayItem } from "./types";

export interface ForkCandidate {
  displayItemId: string;
  turnId: string;
}

export interface RollbackCandidate {
  turnId: string;
  displayItemId: string;
  text: string;
}

export function forkCandidatesFromItems(items: readonly DisplayItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const item of items) {
    if (!item.turnId || !isCompletedTurnOutcomeMessage(item)) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { displayItemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function isForkCandidateItem(item: DisplayItem, candidates: readonly ForkCandidate[]): boolean {
  return candidates.some((candidate) => item.id === candidate.displayItemId && item.turnId === candidate.turnId);
}

export function turnsAfterTurnId(items: readonly DisplayItem[], turnId: string): number | null {
  const turnIds = orderedTurnIds(items);
  const index = turnIds.indexOf(turnId);
  return index === -1 ? null : turnIds.length - index - 1;
}

export function rollbackCandidateFromItems(items: readonly DisplayItem[]): RollbackCandidate | null {
  const lastTurnId = latestTurnId(items);
  if (!lastTurnId) return null;

  const userMessage = items.find((item): item is MessageDisplayItem => isUserMessageForTurn(item, lastTurnId));
  if (!userMessage) return null;

  return {
    turnId: lastTurnId,
    displayItemId: userMessage.id,
    text: userMessage.text,
  };
}

export function isRollbackCandidateItem(item: DisplayItem, candidate: RollbackCandidate | null): boolean {
  return Boolean(
    candidate && item.kind === "message" && item.role === "user" && item.id === candidate.displayItemId && item.turnId === candidate.turnId,
  );
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

function latestTurnId(items: readonly DisplayItem[]): string | null {
  for (const item of [...items].reverse()) {
    if (item.turnId) return item.turnId;
  }
  return null;
}

function isUserMessageForTurn(item: DisplayItem, turnId: string): item is MessageDisplayItem {
  return item.kind === "message" && item.role === "user" && item.turnId === turnId;
}
