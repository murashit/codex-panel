import type { MessageStreamItem } from "../items";
import type { PresentationActions, PresentationClassification, PresentationSemanticKind } from "./types";

export function presentationClassificationsFromMessageStreamItems(items: readonly MessageStreamItem[]): PresentationClassification[] {
  const seenUserMessagesByTurn = new Map<string, number>();
  return items.map((item) => presentationClassificationFromMessageStreamItem(item, seenUserMessagesByTurn));
}

function presentationClassificationFromMessageStreamItem(
  item: MessageStreamItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): PresentationClassification {
  const semanticKind = semanticKindForMessageStreamItem(item, seenUserMessagesByTurn);
  return {
    item,
    semanticKind,
    actions: presentationActionsForMessageStreamItem(item, semanticKind),
  };
}

export function presentationActionsForMessageStreamItem(
  item: MessageStreamItem,
  semanticKind = semanticKindForMessageStreamItem(item),
): PresentationActions {
  const isCompletedTurnOutcome =
    (semanticKind === "assistantResponse" || semanticKind === "proposedPlan") &&
    item.kind === "message" &&
    item.messageState === "completed";
  return {
    canForkFromHere: isCompletedTurnOutcome,
    canRollbackToPrompt: semanticKind === "userPrompt",
    canImplementPlan: semanticKind === "proposedPlan" && item.kind === "message" && item.messageState === "completed",
    isTurnOutcome: isCompletedTurnOutcome,
  };
}

function semanticKindForMessageStreamItem(
  item: MessageStreamItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): PresentationSemanticKind {
  switch (item.kind) {
    case "message":
      if (item.messageKind === "user") return isSteeringUserMessage(item, seenUserMessagesByTurn) ? "steering" : "userPrompt";
      if (item.messageKind === "proposedPlan") return "proposedPlan";
      return "assistantResponse";
    case "command":
      return "commandRun";
    case "fileChange":
      return "filePatch";
    case "tool":
      return item.activityKind === "userSteered" ? "steering" : "toolCall";
    case "hook":
      return "hookRun";
    case "reasoning":
      return "reasoningNote";
    case "taskProgress":
      return "taskProgress";
    case "agent":
      return "agentActivity";
    case "contextCompaction":
      return "contextCompaction";
    case "goal":
      return "goalChange";
    case "approvalResult":
      return "approvalResult";
    case "userInputResult":
      return "userInputResult";
    case "reviewResult":
      return "reviewResult";
    case "system":
      return "systemNotice";
  }
}

function isSteeringUserMessage(
  item: Extract<MessageStreamItem, { kind: "message" }>,
  seenUserMessagesByTurn: Map<string, number>,
): boolean {
  if (item.messageKind !== "user" || !item.turnId) return false;
  const seenCount = seenUserMessagesByTurn.get(item.turnId) ?? 0;
  seenUserMessagesByTurn.set(item.turnId, seenCount + 1);
  return seenCount > 0;
}
