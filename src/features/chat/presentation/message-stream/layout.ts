import type { MessageStreamItem } from "../../domain/message-stream/items";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import {
  messageStreamIsAutoReviewDecision,
  messageStreamIsTurnInitiator,
  messageStreamIsTurnSteer,
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
        id: turnActivityGroupId(turnId),
        turnId,
        summary: "Work details",
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
  return !isEmptyCompletedReasoningItem(classification.item);
}

function isEmptyCompletedReasoningItem(item: MessageStreamItem): boolean {
  return item.kind === "reasoning" && item.executionState === "completed" && textForMessageStreamItem(item).trim().length === 0;
}

function steeringActivityGroupItem(classification: MessageStreamSemanticClassification): MessageStreamActivityGroupItem {
  return {
    type: "steering",
    id: steerActivityGroupId(classification.item.id),
    label: STEERING_ACTIVITY_LABEL,
    text: textForMessageStreamItem(classification.item),
    sourceItemId: classification.item.sourceItemId ?? classification.item.id,
  };
}

function turnActivityGroupId(turnId: string): string {
  return `turn-${turnId}-activity`;
}

function steerActivityGroupId(itemId: string): string {
  return `steer-activity-${itemId}`;
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
    if (!item.turnId || !messageStreamIsAutoReviewDecision(classification)) {
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

function textForMessageStreamItem(item: MessageStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
