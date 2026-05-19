import type { DisplayBlock, DisplayItem, DisplayKind } from "./types";
import { pathRelativeToRoot } from "./paths";
import { executionState } from "./state";

export function displayBlocksForItems(
  items: DisplayItem[],
  activeTurnId: string | null,
  workspaceRoot?: string | null,
  turnDiffs?: ReadonlyMap<string, string>,
): DisplayBlock[] {
  const visibleItems = items.filter(shouldShowDisplayItem);
  const orderedItems = activeTurnId ? moveActiveTaskProgressToEnd(visibleItems, activeTurnId) : visibleItems;
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const finalAssistantIdByTurn = finalAssistantItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...finalAssistantIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryAssistantIdByTurn = new Map([...finalAssistantIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, DisplayItem[]>();
  for (const item of orderedItems) {
    if (!item.turnId || !groupedTurnIds.has(item.turnId) || !isCompletedTurnDetailItem(item, finalAssistantIdByTurn)) continue;
    const group = groupedActivities.get(item.turnId) ?? [];
    group.push(item);
    groupedActivities.set(item.turnId, group);
  }

  const blocks: DisplayBlock[] = [];
  for (const item of orderedItems) {
    const turnId = item.turnId;
    if (turnId && groupedActivities.has(turnId) && isCompletedTurnDetailItem(item, finalAssistantIdByTurn)) {
      continue;
    }
    if (turnId && finalAssistantIdByTurn.get(turnId) === item.id && groupedActivities.has(turnId)) {
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
      item: itemWithTurnSummaries(item, editedFilesByTurn, autoReviewSummariesByTurn, summaryAssistantIdByTurn, turnDiffs),
    });
  }

  return blocks;
}

function moveActiveTaskProgressToEnd(items: DisplayItem[], activeTurnId: string): DisplayItem[] {
  const activeTaskProgress = items.filter((item) => item.kind === "taskProgress" && item.turnId === activeTurnId);
  if (activeTaskProgress.length === 0) return items;
  return [...items.filter((item) => item.kind !== "taskProgress" || item.turnId !== activeTurnId), ...activeTaskProgress];
}

function shouldShowDisplayItem(item: DisplayItem): boolean {
  return item.kind !== "reasoning" || executionState(item) !== "completed" || item.text.trim().length > 0;
}

function isCompletedTurnDetailItem(item: DisplayItem, finalAssistantIdByTurn: Map<string, string>): boolean {
  if (!item.turnId || item.role === "user") return false;
  return finalAssistantIdByTurn.get(item.turnId) !== item.id;
}

function finalAssistantItemsByTurn(items: DisplayItem[]): Map<string, string> {
  const finalAssistantIdByTurn = new Map<string, string>();
  for (const item of items) {
    if (!item.turnId || !isFinalAssistantMessage(item)) continue;
    finalAssistantIdByTurn.set(item.turnId, item.id);
  }
  return finalAssistantIdByTurn;
}

function isFinalAssistantMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "assistant" && item.markdown !== false;
}

function itemWithTurnSummaries(
  item: DisplayItem,
  editedFilesByTurn: Map<string, string[]>,
  autoReviewSummariesByTurn: Map<string, string[]>,
  finalAssistantIdByTurn: Map<string, string>,
  turnDiffs?: ReadonlyMap<string, string>,
): DisplayItem {
  if (!item.turnId || finalAssistantIdByTurn.get(item.turnId) !== item.id) return item;
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

function editedFilesForTurns(items: DisplayItem[], workspaceRoot?: string | null): Map<string, string[]> {
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

function autoReviewSummariesForTurns(items: DisplayItem[]): Map<string, string[]> {
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

function turnActivitySummary(items: DisplayItem[]): string {
  const parts = [
    countMatchingLabel(items, (item) => item.kind === "message" && item.role === "assistant", "response", "responses"),
    countLabel(items, "taskProgress", "task progress"),
    countLabel(items, "agent", "agent"),
    countLabel(items, "command", "command"),
    countLabel(items, "fileChange", "file change"),
    countLabel(items, "tool", "tool"),
    countLabel(items, "hook", "hook"),
    countLabel(items, "reasoning", "thought", "thought notes"),
    countLabel(items, "approvalResult", "approval"),
    countLabel(items, "userInputResult", "input"),
    countLabel(items, "reviewResult", "review"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "Work details";
  return `Work details: ${parts.join(", ")}`;
}

function countMatchingLabel(
  items: DisplayItem[],
  predicate: (item: DisplayItem) => boolean,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter(predicate).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${count} ${pluralLabel}`;
}

function countLabel(items: DisplayItem[], kind: DisplayKind, label: string, pluralLabel = `${label}s`): string | null {
  const count = items.filter((item) => item.kind === kind).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${count} ${pluralLabel}`;
}
