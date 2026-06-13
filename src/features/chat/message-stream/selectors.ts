import type { AssistantAuthoredMessageStreamItem, MessageStreamItem } from "./items";
import { timelineActionsForMessageStreamItem, timelineItemsFromMessageStreamItems } from "./timeline/from-items";

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
  for (const item of timelineItemsFromMessageStreamItems(items)) {
    if (!item.turnId || !item.actions.isTurnOutcome) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { itemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function isAssistantAuthoredMessage(item: MessageStreamItem): item is AssistantAuthoredMessageStreamItem {
  return item.kind === "message" && (item.messageKind === "assistantResponse" || item.messageKind === "proposedPlan");
}

export function isCompletedTurnOutcomeMessage(item: MessageStreamItem): boolean {
  return timelineActionsForMessageStreamItem(item).isTurnOutcome;
}

export function isForkCandidateItem(item: MessageStreamItem, candidates: readonly ForkCandidate[]): boolean {
  return candidates.some((candidate) => item.id === candidate.itemId && item.turnId === candidate.turnId);
}

export function isRollbackCandidateItem(item: MessageStreamItem, candidate: RollbackCandidateItem | null): boolean {
  return Boolean(
    candidate && item.kind === "message" && item.role === "user" && item.id === candidate.itemId && item.turnId === candidate.turnId,
  );
}
