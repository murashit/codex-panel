import type { MessageStreamItem, ExecutionState } from "../items";
import type {
  TimelineActions,
  TimelineAuthorship,
  TimelineDetailShape,
  TimelineItem,
  TimelinePlacement,
  TimelineRenderSurface,
  TimelineSemanticKind,
} from "./types";

export function timelineItemsFromMessageStreamItems(items: readonly MessageStreamItem[]): TimelineItem[] {
  const seenUserMessagesByTurn = new Map<string, number>();
  return items.map((item) => timelineItemFromMessageStreamItem(item, seenUserMessagesByTurn));
}

export function timelineItemFromMessageStreamItem(
  item: MessageStreamItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): TimelineItem {
  const semanticKind = semanticKindForMessageStreamItem(item, seenUserMessagesByTurn);
  const actions = timelineActionsForMessageStreamItem(item, semanticKind);
  const copyText = "copyText" in item ? item.copyText : undefined;
  const base = {
    id: item.id,
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    ...(item.turnId ? { turnId: item.turnId } : {}),
    semanticKind,
    authorship: authorshipForSemanticKind(semanticKind),
    placement: placementForSemanticKind(semanticKind),
    detailShape: detailShapeForMessageStreamItem(item, semanticKind),
    renderSurface: renderSurfaceForMessageStreamItem(item),
    lifecycle: lifecycleForMessageStreamItem(item),
    text: timelineTextForMessageStreamItem(item),
    ...definedProp("copyText", copyText),
    actions,
    streamItem: item,
  };
  if (item.kind === "fileChange") return { ...base, changes: item.changes } as TimelineItem;
  return base as TimelineItem;
}

function timelineTextForMessageStreamItem(item: MessageStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

export function timelineActionsForMessageStreamItem(
  item: MessageStreamItem,
  semanticKind = semanticKindForMessageStreamItem(item),
): TimelineActions {
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
): TimelineSemanticKind {
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

function authorshipForSemanticKind(kind: TimelineSemanticKind): TimelineAuthorship {
  if (kind === "userPrompt" || kind === "steering" || kind === "userInputResult") return "user";
  if (kind === "assistantResponse" || kind === "proposedPlan") return "assistant";
  if (kind === "systemNotice") return "panel";
  return "runtime";
}

function placementForSemanticKind(kind: TimelineSemanticKind): TimelinePlacement {
  if (kind === "userPrompt" || kind === "assistantResponse" || kind === "proposedPlan") return "primaryTranscript";
  if (kind === "systemNotice") return "panelNotice";
  if (kind === "taskProgress" || kind === "agentActivity") return "liveStatus";
  return "workLog";
}

function detailShapeForMessageStreamItem(item: MessageStreamItem, semanticKind: TimelineSemanticKind): TimelineDetailShape {
  switch (item.kind) {
    case "message":
      return semanticKind === "proposedPlan" && item.messageState === "streaming" ? "plainText" : "markdownText";
    case "system":
    case "userInputResult":
      return "plainText";
    case "command":
      return "commandAudit";
    case "fileChange":
      return "diffSet";
    case "taskProgress":
      return "taskList";
    case "agent":
      return "agentActivity";
    case "goal":
    case "contextCompaction":
    case "approvalResult":
    case "reviewResult":
      return "eventSummary";
    case "tool":
    case "hook":
      return hasGenericToolDetails(item) ? "jsonAudit" : "plainText";
    case "reasoning":
      return "plainText";
  }
}

function hasGenericToolDetails(item: Extract<MessageStreamItem, { kind: "tool" | "hook" }>): boolean {
  if (item.kind === "hook") return Boolean(item.hookRun);
  return Boolean(item.toolCall ?? item.webSearch ?? item.imageGeneration);
}

function renderSurfaceForMessageStreamItem(item: MessageStreamItem): TimelineRenderSurface {
  if (item.kind === "message" || item.kind === "system" || item.kind === "userInputResult") return "textMessage";
  if (item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction") {
    return "workItem";
  }
  return "toolResult";
}

function lifecycleForMessageStreamItem(item: MessageStreamItem): ExecutionState {
  if (item.kind === "message") return item.messageState === "streaming" ? "running" : "completed";
  return item.executionState ?? null;
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
