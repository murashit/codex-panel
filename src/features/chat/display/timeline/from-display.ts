import type { DisplayItem, ExecutionState } from "../types";
import type {
  TimelineActions,
  TimelineAuthorship,
  TimelineDetailShape,
  TimelineItem,
  TimelinePlacement,
  TimelineRenderSurface,
  TimelineSemanticKind,
} from "./types";

export function timelineItemsFromDisplayItems(items: readonly DisplayItem[]): TimelineItem[] {
  const seenUserMessagesByTurn = new Map<string, number>();
  return items.map((item) => timelineItemFromDisplayItem(item, seenUserMessagesByTurn));
}

export function timelineItemFromDisplayItem(
  item: DisplayItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): TimelineItem {
  const semanticKind = semanticKindForDisplayItem(item, seenUserMessagesByTurn);
  const actions = timelineActionsForDisplayItem(item, semanticKind);
  const copyText = "copyText" in item ? item.copyText : undefined;
  const base = {
    id: item.id,
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    ...(item.turnId ? { turnId: item.turnId } : {}),
    semanticKind,
    authorship: authorshipForSemanticKind(semanticKind),
    placement: placementForSemanticKind(semanticKind),
    detailShape: detailShapeForDisplayItem(item, semanticKind),
    renderSurface: renderSurfaceForDisplayItem(item),
    lifecycle: lifecycleForDisplayItem(item),
    text: item.text,
    ...definedProp("copyText", copyText),
    actions,
    displayItem: item,
  };
  if ("details" in item) return { ...base, ...definedProp("details", item.details) } as TimelineItem;
  if (item.kind === "fileChange") return { ...base, changes: item.changes } as TimelineItem;
  return base as TimelineItem;
}

export function timelineActionsForDisplayItem(item: DisplayItem, semanticKind = semanticKindForDisplayItem(item)): TimelineActions {
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

function semanticKindForDisplayItem(
  item: DisplayItem,
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

function isSteeringUserMessage(item: Extract<DisplayItem, { kind: "message" }>, seenUserMessagesByTurn: Map<string, number>): boolean {
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

function detailShapeForDisplayItem(item: DisplayItem, semanticKind: TimelineSemanticKind): TimelineDetailShape {
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
      return item.details && item.details.length > 0 ? "jsonAudit" : "plainText";
    case "reasoning":
      return "plainText";
  }
}

function renderSurfaceForDisplayItem(item: DisplayItem): TimelineRenderSurface {
  if (item.kind === "message" || item.kind === "system" || item.kind === "userInputResult") return "textMessage";
  if (item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction") {
    return "workItem";
  }
  return "toolResult";
}

function lifecycleForDisplayItem(item: DisplayItem): ExecutionState {
  if (item.kind === "message") return item.messageState === "streaming" ? "running" : "completed";
  return item.executionState ?? null;
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
