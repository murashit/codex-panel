import type { DisplayItem, MessageDisplayItem } from "./types";

export interface RollbackCandidate {
  turnId: string;
  itemId: string;
  text: string;
}

export function rollbackCandidateFromItems(items: readonly DisplayItem[]): RollbackCandidate | null {
  const lastTurnId = latestTurnId(items);
  if (!lastTurnId) return null;

  const userMessage = items.find((item): item is MessageDisplayItem => isUserMessageForTurn(item, lastTurnId));
  if (!userMessage) return null;

  return {
    turnId: lastTurnId,
    itemId: userMessage.id,
    text: userMessage.text,
  };
}

export function isRollbackCandidateItem(item: DisplayItem, candidate: RollbackCandidate | null): boolean {
  return Boolean(
    candidate && item.kind === "message" && item.role === "user" && item.id === candidate.itemId && item.turnId === candidate.turnId,
  );
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
