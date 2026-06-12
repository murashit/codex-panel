import type { DisplayBlock, DisplayItem, DisplayKind } from "./types";
import { isCompletedTurnOutcomeMessage } from "./turn-outcome-message";
import { pathRelativeToRoot } from "./paths";

const STEERING_ACTIVITY_LABEL = "steer";
const STEERING_ACTIVITY_KIND = "userSteered";

export function displayBlocksForItems(
  items: readonly DisplayItem[],
  activeTurnId: string | null,
  workspaceRoot?: string | null,
  turnDiffs?: ReadonlyMap<string, string>,
): DisplayBlock[] {
  const visibleItems = items.filter(shouldShowDisplayItem);
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const turnOutcomeIdByTurn = turnOutcomeItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...turnOutcomeIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryOutcomeIdByTurn = new Map([...turnOutcomeIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, DisplayItem[]>();
  const seenUserMessagesByTurn = new Map<string, number>();
  for (const item of visibleItems) {
    const turnId = item.turnId;
    if (!turnId || !groupedTurnIds.has(turnId)) continue;
    if (isSteeringUserMessage(item, seenUserMessagesByTurn)) {
      const group = groupedActivities.get(turnId) ?? [];
      group.push(steeringActivityItem(item, turnId));
      groupedActivities.set(turnId, group);
      continue;
    }
    if (!isCompletedTurnDetailItem(item, turnOutcomeIdByTurn)) continue;
    const group = groupedActivities.get(turnId) ?? [];
    group.push(item);
    groupedActivities.set(turnId, group);
  }

  const blocks: DisplayBlock[] = [];
  for (const item of visibleItems) {
    const turnId = item.turnId;
    if (turnId && groupedActivities.has(turnId) && isCompletedTurnDetailItem(item, turnOutcomeIdByTurn)) {
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
      item: itemWithTurnSummaries(item, editedFilesByTurn, autoReviewSummariesByTurn, summaryOutcomeIdByTurn, turnDiffs),
    });
  }

  return blocks;
}

function shouldShowDisplayItem(item: DisplayItem): boolean {
  return item.kind !== "reasoning" || item.executionState !== "completed" || item.text.trim().length > 0;
}

function isSteeringUserMessage(item: DisplayItem, seenUserMessagesByTurn: Map<string, number>): boolean {
  if (!item.turnId || item.kind !== "message" || item.role !== "user") return false;
  const seenCount = seenUserMessagesByTurn.get(item.turnId) ?? 0;
  seenUserMessagesByTurn.set(item.turnId, seenCount + 1);
  // App-server represents steering as subsequent user messages in the same turn.
  return seenCount > 0;
}

function steeringActivityItem(item: DisplayItem, turnId: string): DisplayItem {
  return {
    id: `steer-activity-${item.id}`,
    kind: "tool",
    role: "tool",
    text: item.text,
    turnId,
    ...(item.itemId ? { itemId: item.itemId } : {}),
    activityKind: STEERING_ACTIVITY_KIND,
    toolLabel: STEERING_ACTIVITY_LABEL,
  };
}

function isCompletedTurnDetailItem(item: DisplayItem, turnOutcomeIdByTurn: Map<string, string>): boolean {
  if (!item.turnId || item.role === "user") return false;
  return turnOutcomeIdByTurn.get(item.turnId) !== item.id;
}

function turnOutcomeItemsByTurn(items: readonly DisplayItem[]): Map<string, string> {
  const turnOutcomeIdByTurn = new Map<string, string>();
  for (const item of items) {
    if (!item.turnId || !isCompletedTurnOutcomeMessage(item)) continue;
    turnOutcomeIdByTurn.set(item.turnId, item.id);
  }
  return turnOutcomeIdByTurn;
}

function itemWithTurnSummaries(
  item: DisplayItem,
  editedFilesByTurn: Map<string, string[]>,
  autoReviewSummariesByTurn: Map<string, string[]>,
  turnOutcomeIdByTurn: Map<string, string>,
  turnDiffs?: ReadonlyMap<string, string>,
): DisplayItem {
  if (!item.turnId || turnOutcomeIdByTurn.get(item.turnId) !== item.id) return item;
  if (item.kind !== "message") return item;
  const editedFiles = editedFilesByTurn.get(item.turnId);
  const autoReviewSummaries = autoReviewSummariesByTurn.get(item.turnId);
  const diff = turnDiffs?.get(item.turnId);
  const turnDiff = diff && diff.trim().length > 0 ? { diff } : undefined;
  if ((!editedFiles || editedFiles.length === 0) && (!autoReviewSummaries || autoReviewSummaries.length === 0) && !turnDiff) return item;
  return {
    ...item,
    ...(editedFiles && editedFiles.length > 0 ? { editedFiles } : {}),
    ...(turnDiff ? { turnDiff } : {}),
    ...(autoReviewSummaries && autoReviewSummaries.length > 0 ? { autoReviewSummaries } : {}),
  };
}

function editedFilesForTurns(items: readonly DisplayItem[], workspaceRoot?: string | null): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.turnId || item.kind !== "fileChange") continue;
    const files = editedFilesForItem(item, workspaceRoot);
    if (files.length === 0) continue;
    const set = byTurn.get(item.turnId) ?? new Set<string>();
    files.forEach((file) => set.add(file));
    byTurn.set(item.turnId, set);
  }

  return new Map([...byTurn].map(([turnId, files]) => [turnId, [...files].sort((a, b) => a.localeCompare(b))]));
}

function editedFilesForItem(item: DisplayItem, workspaceRoot?: string | null): string[] {
  if (item.kind !== "fileChange") return [];
  return item.changes.flatMap((change) =>
    change.path && change.path !== "(unknown)" ? [pathRelativeToRoot(change.path, workspaceRoot)] : [],
  );
}

function autoReviewSummariesForTurns(items: readonly DisplayItem[]): Map<string, string[]> {
  const byTurn = new Map<string, string[]>();
  for (const item of items) {
    if (!item.turnId || item.kind !== "reviewResult") continue;
    const summary = item.text.trim();
    if (!summary) continue;
    const summaries = byTurn.get(item.turnId) ?? [];
    summaries.push(summary);
    byTurn.set(item.turnId, summaries);
  }
  return byTurn;
}

function turnActivitySummary(items: readonly DisplayItem[]): string {
  const parts = [
    countMatchingLabel(items, (item) => item.kind === "message" && item.role === "assistant", "response", "responses"),
    countMatchingLabel(items, isSteeringActivityDisplayItem, "steer", "steers"),
    countLabel(items, "taskProgress", "task progress"),
    countLabel(items, "agent", "agent"),
    countLabel(items, "command", "command"),
    countLabel(items, "fileChange", "file change"),
    countMatchingLabel(items, (item) => item.kind === "tool" && !isSteeringActivityDisplayItem(item), "tool"),
    countLabel(items, "hook", "hook"),
    countLabel(items, "reasoning", "thought", "thought notes"),
    countLabel(items, "contextCompaction", "context compaction"),
    countLabel(items, "approvalResult", "approval"),
    countLabel(items, "userInputResult", "input"),
    countLabel(items, "reviewResult", "review"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "Work details";
  return `Work details: ${parts.join(", ")}`;
}

function isSteeringActivityDisplayItem(item: DisplayItem): boolean {
  return item.kind === "tool" && item.activityKind === STEERING_ACTIVITY_KIND;
}

function countMatchingLabel(
  items: readonly DisplayItem[],
  predicate: (item: DisplayItem) => boolean,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter(predicate).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${String(count)} ${pluralLabel}`;
}

function countLabel(items: readonly DisplayItem[], kind: DisplayKind, label: string, pluralLabel = `${label}s`): string | null {
  const count = items.filter((item) => item.kind === kind).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${String(count)} ${pluralLabel}`;
}
