import { pathRelativeToRoot } from "../../../../domain/vault/paths";
import { lastTurnOutcomeItemsByTurn, threadStreamUserRoles } from "../../domain/thread-stream/conversation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { threadStreamIsAutoReviewDecision } from "../../domain/thread-stream/review-items";

const STEERING_ACTIVITY_LABEL = "steering";

export interface ThreadStreamItemAnnotations {
  editedFiles?: string[];
  turnDiff?: { diff: string };
  autoReviewSummaries?: string[];
}

type ThreadStreamActivityGroupItem =
  | {
      type: "item";
      id: string;
      item: ThreadStreamItem;
    }
  | {
      type: "steering";
      id: string;
      label: typeof STEERING_ACTIVITY_LABEL;
      text: string;
      sourceItemId: string;
    };

export type ThreadStreamLayoutBlock =
  | {
      type: "item";
      item: ThreadStreamItem;
      annotations?: ThreadStreamItemAnnotations;
    }
  | {
      type: "activityGroup";
      id: string;
      turnId: string;
      summary: string;
      items: ThreadStreamActivityGroupItem[];
    };

export function threadStreamLayoutBlocks(
  items: readonly ThreadStreamItem[],
  activeTurnId: string | null,
  workspaceRoot: string,
  turnDiffs: ReadonlyMap<string, string>,
): ThreadStreamLayoutBlock[] {
  const visibleItems = items.filter((item) => !isEmptyCompletedReasoningItem(item));
  const roles = threadStreamUserRoles(visibleItems);
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const turnOutcomeIdByTurn = new Map([...lastTurnOutcomeItemsByTurn(visibleItems)].map(([turnId, item]) => [turnId, item.id]));
  const groupedTurnIds = new Set([...turnOutcomeIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryOutcomeIdByTurn = new Map([...turnOutcomeIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, GroupedActivity[]>();
  for (const [index, item] of visibleItems.entries()) {
    const turnId = item.turnId;
    if (!turnId || !groupedTurnIds.has(turnId)) continue;
    if (roles[index] === "steer" && item.kind === "dialogue") {
      const group = groupedActivities.get(turnId) ?? [];
      group.push(steeringActivityGroupItem(item));
      groupedActivities.set(turnId, group);
      continue;
    }
    if (!isCompletedTurnDetailItem(item, roles[index], turnOutcomeIdByTurn)) continue;
    const group = groupedActivities.get(turnId) ?? [];
    group.push({ type: "item", id: item.id, item });
    groupedActivities.set(turnId, group);
  }

  const blocks: ThreadStreamLayoutBlock[] = [];
  for (const [index, item] of visibleItems.entries()) {
    const turnId = item.turnId;
    if (turnId && groupedActivities.has(turnId) && isCompletedTurnDetailItem(item, roles[index], turnOutcomeIdByTurn)) {
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
      ...definedProp(
        "annotations",
        annotationsForTurnOutcome(item, editedFilesByTurn, autoReviewSummariesByTurn, summaryOutcomeIdByTurn, turnDiffs),
      ),
    });
  }

  return blocks;
}

type GroupedActivity = ThreadStreamActivityGroupItem;

function isEmptyCompletedReasoningItem(item: ThreadStreamItem): boolean {
  return item.kind === "reasoning" && item.executionState === "completed" && textForThreadStreamItem(item).trim().length === 0;
}

function steeringActivityGroupItem(item: ThreadStreamItem): ThreadStreamActivityGroupItem {
  return {
    type: "steering",
    id: steerActivityGroupId(item.id),
    label: STEERING_ACTIVITY_LABEL,
    text: textForThreadStreamItem(item),
    sourceItemId: item.sourceItemId ?? item.id,
  };
}

function turnActivityGroupId(turnId: string): string {
  return `turn-${turnId}-activity`;
}

function steerActivityGroupId(itemId: string): string {
  return `steer-activity-${itemId}`;
}

function isCompletedTurnDetailItem(
  item: ThreadStreamItem,
  role: "initiator" | "steer" | null | undefined,
  turnOutcomeIdByTurn: Map<string, string>,
): boolean {
  const turnId = item.turnId;
  if (!turnId || role) return false;
  return turnOutcomeIdByTurn.get(turnId) !== item.id;
}

function annotationsForTurnOutcome(
  item: ThreadStreamItem,
  editedFilesByTurn: Map<string, string[]>,
  autoReviewSummariesByTurn: Map<string, string[]>,
  turnOutcomeIdByTurn: Map<string, string>,
  turnDiffs: ReadonlyMap<string, string>,
): ThreadStreamItemAnnotations | undefined {
  if (!item.turnId || turnOutcomeIdByTurn.get(item.turnId) !== item.id) return undefined;
  if (item.kind !== "dialogue") return undefined;
  const editedFiles = editedFilesByTurn.get(item.turnId);
  const autoReviewSummaries = autoReviewSummariesByTurn.get(item.turnId);
  const diff = turnDiffs.get(item.turnId);
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

function editedFilesForTurns(items: readonly ThreadStreamItem[], workspaceRoot: string): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.turnId || item.kind !== "fileChange") continue;
    const files = editedFilesForItem(item, workspaceRoot);
    if (files.length === 0) continue;
    const set = byTurn.get(item.turnId) ?? new Set<string>();
    for (const file of files) set.add(file);
    byTurn.set(item.turnId, set);
  }

  return new Map([...byTurn].map(([turnId, files]) => [turnId, [...files].sort((a, b) => a.localeCompare(b))]));
}

function editedFilesForItem(item: ThreadStreamItem, workspaceRoot: string): string[] {
  if (item.kind !== "fileChange") return [];
  return item.changes.flatMap((change) =>
    change.path && change.path !== "(unknown)" ? [pathRelativeToRoot(change.path, workspaceRoot)] : [],
  );
}

function autoReviewSummariesForTurns(items: readonly ThreadStreamItem[]): Map<string, string[]> {
  const byTurn = new Map<string, string[]>();
  for (const item of items) {
    if (!item.turnId || !threadStreamIsAutoReviewDecision(item)) {
      continue;
    }
    const summary = textForThreadStreamItem(item).trim();
    if (!summary) continue;
    const summaries = byTurn.get(item.turnId) ?? [];
    summaries.push(summary);
    byTurn.set(item.turnId, summaries);
  }
  return byTurn;
}

function textForThreadStreamItem(item: ThreadStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
