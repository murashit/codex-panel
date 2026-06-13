import type { DisplayBlock, DisplayItem, MessageStreamItem } from "../types";
import { pathRelativeToRoot } from "../details/path-labels";
import { timelineItemsFromDisplayItems } from "../timeline/from-display";
import type { TimelineItem, TimelineSemanticKind } from "../timeline/types";

const STEERING_ACTIVITY_LABEL = "steer";
const STEERING_ACTIVITY_KIND = "userSteered";

export function displayBlocksForItems(
  items: readonly DisplayItem[],
  activeTurnId: string | null,
  workspaceRoot?: string | null,
  turnDiffs?: ReadonlyMap<string, string>,
): DisplayBlock[] {
  const visibleItems = timelineItemsFromDisplayItems(items).filter(shouldShowTimelineItem);
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const turnOutcomeIdByTurn = turnOutcomeItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...turnOutcomeIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryOutcomeIdByTurn = new Map([...turnOutcomeIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, GroupedActivity[]>();
  for (const item of visibleItems) {
    const turnId = item.turnId;
    if (!turnId || !groupedTurnIds.has(turnId)) continue;
    if (item.semanticKind === "steering" && item.displayItem.kind === "message") {
      const group = groupedActivities.get(turnId) ?? [];
      group.push({ item: steeringActivityItem(item, turnId), semanticKind: "steering" });
      groupedActivities.set(turnId, group);
      continue;
    }
    if (!isCompletedTurnDetailItem(item, turnOutcomeIdByTurn)) continue;
    const group = groupedActivities.get(turnId) ?? [];
    group.push({ item: item.displayItem, semanticKind: item.semanticKind });
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
        items: groupItems.map((activity) => activity.item),
      });
    }
    blocks.push({
      type: "item",
      item: itemWithTurnSummaries(item.displayItem, editedFilesByTurn, autoReviewSummariesByTurn, summaryOutcomeIdByTurn, turnDiffs),
    });
  }

  return blocks;
}

interface GroupedActivity {
  item: MessageStreamItem;
  semanticKind: TimelineSemanticKind;
}

function shouldShowTimelineItem(item: TimelineItem): boolean {
  return item.semanticKind !== "reasoningNote" || item.lifecycle !== "completed" || item.text.trim().length > 0;
}

function steeringActivityItem(item: TimelineItem, turnId: string): DisplayItem {
  return {
    id: `steer-activity-${item.id}`,
    kind: "tool",
    role: "tool",
    text: item.text,
    turnId,
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    activityKind: STEERING_ACTIVITY_KIND,
    toolLabel: STEERING_ACTIVITY_LABEL,
  };
}

function isCompletedTurnDetailItem(item: TimelineItem, turnOutcomeIdByTurn: Map<string, string>): boolean {
  if (!item.turnId || item.semanticKind === "userPrompt" || item.semanticKind === "steering") return false;
  return turnOutcomeIdByTurn.get(item.turnId) !== item.id;
}

function turnOutcomeItemsByTurn(items: readonly TimelineItem[]): Map<string, string> {
  const turnOutcomeIdByTurn = new Map<string, string>();
  for (const item of items) {
    if (!item.turnId || !item.actions.isTurnOutcome) continue;
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

function editedFilesForTurns(items: readonly TimelineItem[], workspaceRoot?: string | null): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.turnId || item.semanticKind !== "filePatch") continue;
    const files = editedFilesForItem(item.displayItem, workspaceRoot);
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

function autoReviewSummariesForTurns(items: readonly TimelineItem[]): Map<string, string[]> {
  const byTurn = new Map<string, string[]>();
  for (const item of items) {
    if (!item.turnId || item.semanticKind !== "reviewResult") continue;
    const summary = item.text.trim();
    if (!summary) continue;
    const summaries = byTurn.get(item.turnId) ?? [];
    summaries.push(summary);
    byTurn.set(item.turnId, summaries);
  }
  return byTurn;
}

function turnActivitySummary(items: readonly GroupedActivity[]): string {
  const parts = [
    countSemanticLabel(items, "assistantResponse", "response", "responses"),
    countSemanticLabel(items, "proposedPlan", "plan", "plans"),
    countSemanticLabel(items, "steering", "steer", "steers"),
    countSemanticLabel(items, "taskProgress", "task progress"),
    countSemanticLabel(items, "agentActivity", "agent"),
    countSemanticLabel(items, "commandRun", "command"),
    countSemanticLabel(items, "filePatch", "file change"),
    countSemanticLabel(items, "toolCall", "tool"),
    countSemanticLabel(items, "hookRun", "hook"),
    countSemanticLabel(items, "reasoningNote", "thought", "thought notes"),
    countSemanticLabel(items, "contextCompaction", "context compaction"),
    countSemanticLabel(items, "approvalResult", "approval"),
    countSemanticLabel(items, "userInputResult", "input"),
    countSemanticLabel(items, "reviewResult", "review"),
    countSemanticLabel(items, "goalChange", "goal"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "Work details";
  return `Work details: ${parts.join(", ")}`;
}

function countSemanticLabel(
  items: readonly GroupedActivity[],
  semanticKind: TimelineSemanticKind,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter((item) => item.semanticKind === semanticKind).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${String(count)} ${pluralLabel}`;
}
