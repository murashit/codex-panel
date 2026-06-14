import type { MessageStreamItem } from "../../domain/message-stream/items";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import {
  messageStreamIsApprovalResult,
  messageStreamIsAssistantResponse,
  messageStreamIsCommandEvidence,
  messageStreamIsContextCompaction,
  messageStreamIsCoordinationProgress,
  messageStreamIsGoalChange,
  messageStreamIsHookEvidence,
  messageStreamIsPermissionDecision,
  messageStreamIsProposedPlan,
  messageStreamIsReasoningProgress,
  messageStreamIsReviewResult,
  messageStreamIsTaskProgress,
  messageStreamIsToolEvidence,
  messageStreamIsTurnInitiator,
  messageStreamIsTurnSteer,
  messageStreamIsUserInputResult,
  messageStreamIsWorkspaceResult,
  messageStreamSemanticClassifications,
} from "../../domain/message-stream/semantics";
import type { MessageStreamSemanticClassification } from "../../domain/message-stream/semantics";

const STEERING_ACTIVITY_LABEL = "steer";

export interface MessageStreamItemAnnotations {
  editedFiles?: string[];
  turnDiff?: { diff: string };
  autoReviewSummaries?: string[];
}

type MessageStreamActivityGroupItem =
  | {
      type: "item";
      id: string;
      item: MessageStreamItem;
      classification: MessageStreamSemanticClassification;
    }
  | {
      type: "steering";
      id: string;
      label: typeof STEERING_ACTIVITY_LABEL;
      text: string;
      sourceItemId: string;
    };

export type MessageStreamLayoutBlock =
  | {
      type: "item";
      item: MessageStreamItem;
      classification: MessageStreamSemanticClassification;
      annotations?: MessageStreamItemAnnotations;
    }
  | {
      type: "activityGroup";
      id: string;
      turnId: string;
      summary: string;
      items: MessageStreamActivityGroupItem[];
    };

export function messageStreamLayoutBlocks(
  items: readonly MessageStreamItem[],
  activeTurnId: string | null,
  workspaceRoot?: string | null,
  turnDiffs?: ReadonlyMap<string, string>,
): MessageStreamLayoutBlock[] {
  const visibleItems = messageStreamSemanticClassifications(items).filter(shouldShowPresentationItem);
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const turnOutcomeIdByTurn = turnOutcomeItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...turnOutcomeIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryOutcomeIdByTurn = new Map([...turnOutcomeIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, GroupedActivity[]>();
  for (const classification of visibleItems) {
    const { item } = classification;
    const turnId = item.turnId;
    if (!turnId || !groupedTurnIds.has(turnId)) continue;
    if (messageStreamIsTurnSteer(classification) && item.kind === "message") {
      const group = groupedActivities.get(turnId) ?? [];
      group.push(steeringActivityGroupItem(classification));
      groupedActivities.set(turnId, group);
      continue;
    }
    if (!isCompletedTurnDetailItem(classification, turnOutcomeIdByTurn)) continue;
    const group = groupedActivities.get(turnId) ?? [];
    group.push({ type: "item", id: item.id, item, classification });
    groupedActivities.set(turnId, group);
  }

  const blocks: MessageStreamLayoutBlock[] = [];
  for (const classification of visibleItems) {
    const { item } = classification;
    const turnId = item.turnId;
    if (turnId && groupedActivities.has(turnId) && isCompletedTurnDetailItem(classification, turnOutcomeIdByTurn)) {
      continue;
    }
    if (turnId && turnOutcomeIdByTurn.get(turnId) === item.id && groupedActivities.has(turnId)) {
      const groupItems = groupedActivities.get(turnId) ?? [];
      blocks.push({
        type: "activityGroup",
        id: `turn-${turnId}-activity`,
        turnId,
        summary: turnActivitySummary(groupItems),
        items: groupItems,
      });
    }
    blocks.push({
      type: "item",
      item,
      classification,
      ...definedProp(
        "annotations",
        annotationsForTurnOutcome(item, editedFilesByTurn, autoReviewSummariesByTurn, summaryOutcomeIdByTurn, turnDiffs),
      ),
    });
  }

  return blocks;
}

type GroupedActivity = MessageStreamActivityGroupItem;

function shouldShowPresentationItem(classification: MessageStreamSemanticClassification): boolean {
  const { item } = classification;
  return (
    !messageStreamIsReasoningProgress(classification) ||
    item.executionState !== "completed" ||
    textForMessageStreamItem(item).trim().length > 0
  );
}

function steeringActivityGroupItem(classification: MessageStreamSemanticClassification): MessageStreamActivityGroupItem {
  return {
    type: "steering",
    id: `steer-activity-${classification.item.id}`,
    label: STEERING_ACTIVITY_LABEL,
    text: textForMessageStreamItem(classification.item),
    sourceItemId: classification.item.sourceItemId ?? classification.item.id,
  };
}

function isCompletedTurnDetailItem(classification: MessageStreamSemanticClassification, turnOutcomeIdByTurn: Map<string, string>): boolean {
  const turnId = classification.item.turnId;
  if (!turnId || messageStreamIsTurnInitiator(classification) || messageStreamIsTurnSteer(classification)) return false;
  return turnOutcomeIdByTurn.get(turnId) !== classification.item.id;
}

function turnOutcomeItemsByTurn(items: readonly MessageStreamSemanticClassification[]): Map<string, string> {
  const turnOutcomeIdByTurn = new Map<string, string>();
  for (const { item, actions } of items) {
    if (!item.turnId || !actions.isTurnOutcome) continue;
    turnOutcomeIdByTurn.set(item.turnId, item.id);
  }
  return turnOutcomeIdByTurn;
}

function annotationsForTurnOutcome(
  item: MessageStreamItem,
  editedFilesByTurn: Map<string, string[]>,
  autoReviewSummariesByTurn: Map<string, string[]>,
  turnOutcomeIdByTurn: Map<string, string>,
  turnDiffs?: ReadonlyMap<string, string>,
): MessageStreamItemAnnotations | undefined {
  if (!item.turnId || turnOutcomeIdByTurn.get(item.turnId) !== item.id) return undefined;
  if (item.kind !== "message") return undefined;
  const editedFiles = editedFilesByTurn.get(item.turnId);
  const autoReviewSummaries = autoReviewSummariesByTurn.get(item.turnId);
  const diff = turnDiffs?.get(item.turnId);
  const turnDiff = diff && diff.trim().length > 0 ? { diff } : undefined;
  if ((!editedFiles || editedFiles.length === 0) && (!autoReviewSummaries || autoReviewSummaries.length === 0) && !turnDiff) {
    return undefined;
  }
  return {
    ...(editedFiles && editedFiles.length > 0 ? { editedFiles } : {}),
    ...(turnDiff ? { turnDiff } : {}),
    ...(autoReviewSummaries && autoReviewSummaries.length > 0 ? { autoReviewSummaries } : {}),
  };
}

function editedFilesForTurns(items: readonly MessageStreamSemanticClassification[], workspaceRoot?: string | null): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const classification of items) {
    const { item } = classification;
    if (!item.turnId || !messageStreamIsWorkspaceResult(classification)) continue;
    const files = editedFilesForItem(item, workspaceRoot);
    if (files.length === 0) continue;
    const set = byTurn.get(item.turnId) ?? new Set<string>();
    files.forEach((file) => set.add(file));
    byTurn.set(item.turnId, set);
  }

  return new Map([...byTurn].map(([turnId, files]) => [turnId, [...files].sort((a, b) => a.localeCompare(b))]));
}

function editedFilesForItem(item: MessageStreamItem, workspaceRoot?: string | null): string[] {
  if (item.kind !== "fileChange") return [];
  return item.changes.flatMap((change) =>
    change.path && change.path !== "(unknown)" ? [pathRelativeToRoot(change.path, workspaceRoot)] : [],
  );
}

function autoReviewSummariesForTurns(items: readonly MessageStreamSemanticClassification[]): Map<string, string[]> {
  const byTurn = new Map<string, string[]>();
  for (const classification of items) {
    const { item } = classification;
    if (!item.turnId || !messageStreamIsReviewResult(classification) || !messageStreamIsPermissionDecision(classification)) {
      continue;
    }
    const summary = textForMessageStreamItem(item).trim();
    if (!summary) continue;
    const summaries = byTurn.get(item.turnId) ?? [];
    summaries.push(summary);
    byTurn.set(item.turnId, summaries);
  }
  return byTurn;
}

function turnActivitySummary(items: readonly GroupedActivity[]): string {
  const parts = [
    countActivityLabel(
      items,
      (item) => item.type === "item" && messageStreamIsAssistantResponse(item.classification),
      "response",
      "responses",
    ),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsProposedPlan(item.classification), "plan", "plans"),
    countActivityLabel(items, (item) => item.type === "steering", "steer", "steers"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsTaskProgress(item.classification), "task progress"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsCoordinationProgress(item.classification), "agent"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsCommandEvidence(item.classification), "command"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsWorkspaceResult(item.classification), "file change"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsToolEvidence(item.classification), "tool"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsHookEvidence(item.classification), "hook"),
    countActivityLabel(
      items,
      (item) => item.type === "item" && messageStreamIsReasoningProgress(item.classification),
      "thought",
      "thought notes",
    ),
    countActivityLabel(
      items,
      (item) => item.type === "item" && messageStreamIsContextCompaction(item.classification),
      "context compaction",
    ),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsApprovalResult(item.classification), "approval"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsUserInputResult(item.classification), "input"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsReviewResult(item.classification), "review"),
    countActivityLabel(items, (item) => item.type === "item" && messageStreamIsGoalChange(item.classification), "goal"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "Work details";
  return `Work details: ${parts.join(", ")}`;
}

function countActivityLabel(
  items: readonly GroupedActivity[],
  predicate: (item: GroupedActivity) => boolean,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter(predicate).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${String(count)} ${pluralLabel}`;
}

function textForMessageStreamItem(item: MessageStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
