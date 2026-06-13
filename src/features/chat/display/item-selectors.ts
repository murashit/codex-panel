import type { AssistantAuthoredMessageDisplayItem, DisplayItem } from "./types";
import { timelineActionsForDisplayItem, timelineItemsFromDisplayItems } from "./timeline/from-display";

export interface ForkCandidate {
  displayItemId: string;
  turnId: string;
}

interface RollbackCandidateItem {
  turnId: string;
  displayItemId: string;
}

export function forkCandidatesFromItems(items: readonly DisplayItem[]): readonly ForkCandidate[] {
  const turnOutcomeItemsByTurn = new Map<string, ForkCandidate>();
  for (const item of timelineItemsFromDisplayItems(items)) {
    if (!item.turnId || !item.actions.isTurnOutcome) continue;
    turnOutcomeItemsByTurn.set(item.turnId, { displayItemId: item.id, turnId: item.turnId });
  }
  return [...turnOutcomeItemsByTurn.values()];
}

export function isAssistantAuthoredMessage(item: DisplayItem): item is AssistantAuthoredMessageDisplayItem {
  return item.kind === "message" && (item.messageKind === "assistantResponse" || item.messageKind === "proposedPlan");
}

export function isCompletedTurnOutcomeMessage(item: DisplayItem): boolean {
  return timelineActionsForDisplayItem(item).isTurnOutcome;
}

export function isForkCandidateItem(item: DisplayItem, candidates: readonly ForkCandidate[]): boolean {
  return candidates.some((candidate) => item.id === candidate.displayItemId && item.turnId === candidate.turnId);
}

export function isRollbackCandidateItem(item: DisplayItem, candidate: RollbackCandidateItem | null): boolean {
  return Boolean(
    candidate && item.kind === "message" && item.role === "user" && item.id === candidate.displayItemId && item.turnId === candidate.turnId,
  );
}
