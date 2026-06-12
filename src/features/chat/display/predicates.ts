import type { AssistantAuthoredMessageDisplayItem, DisplayItem } from "./types";

export function isAssistantAuthoredMessage(item: DisplayItem): item is AssistantAuthoredMessageDisplayItem {
  return item.kind === "message" && (item.messageKind === "assistantResponse" || item.messageKind === "proposedPlan");
}

export function isCompletedTurnOutcomeMessage(item: DisplayItem): boolean {
  return isAssistantAuthoredMessage(item) && item.messageState === "completed";
}
