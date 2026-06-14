import type { MessageStreamItem } from "../items";
import { pathRelativeToRoot } from "../path-labels";
import { presentationClassificationsFromMessageStreamItems } from "./from-items";
import type { PresentationClassification, PresentationSemanticKind } from "./types";

const STEERING_ACTIVITY_LABEL = "steer";
const STEERING_ACTIVITY_KIND = "userSteered";

export interface MessageStreamItemAnnotations {
  editedFiles?: string[];
  turnDiff?: { diff: string };
  autoReviewSummaries?: string[];
}

export type MessageStreamLayoutBlock =
  | {
      type: "item";
      item: MessageStreamItem;
      annotations?: MessageStreamItemAnnotations;
    }
  | {
      type: "activityGroup";
      id: string;
      turnId: string;
      summary: string;
      items: MessageStreamItem[];
    };

export function messageStreamLayoutBlocks(
  items: readonly MessageStreamItem[],
  activeTurnId: string | null,
  workspaceRoot?: string | null,
  turnDiffs?: ReadonlyMap<string, string>,
): MessageStreamLayoutBlock[] {
  const visibleItems = presentationClassificationsFromMessageStreamItems(items).filter(shouldShowPresentationItem);
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const autoReviewSummariesByTurn = autoReviewSummariesForTurns(visibleItems);
  const turnOutcomeIdByTurn = turnOutcomeItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...turnOutcomeIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));
  const summaryOutcomeIdByTurn = new Map([...turnOutcomeIdByTurn].filter(([turnId]) => groupedTurnIds.has(turnId)));

  const groupedActivities = new Map<string, GroupedActivity[]>();
  for (const classification of visibleItems) {
    const { item, semanticKind } = classification;
    const turnId = item.turnId;
    if (!turnId || !groupedTurnIds.has(turnId)) continue;
    if (semanticKind === "steering" && item.kind === "message") {
      const group = groupedActivities.get(turnId) ?? [];
      group.push({ item: steeringActivityItem(classification, turnId), semanticKind: "steering" });
      groupedActivities.set(turnId, group);
      continue;
    }
    if (!isCompletedTurnDetailItem(classification, turnOutcomeIdByTurn)) continue;
    const group = groupedActivities.get(turnId) ?? [];
    group.push({ item, semanticKind });
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
        items: groupItems.map((activity) => activity.item),
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

interface GroupedActivity {
  item: MessageStreamItem;
  semanticKind: PresentationSemanticKind;
}

function shouldShowPresentationItem(classification: PresentationClassification): boolean {
  const { item, semanticKind } = classification;
  return semanticKind !== "reasoningNote" || item.executionState !== "completed" || textForMessageStreamItem(item).trim().length > 0;
}

function steeringActivityItem({ item }: PresentationClassification, turnId: string): MessageStreamItem {
  return {
    id: `steer-activity-${item.id}`,
    kind: "tool",
    role: "tool",
    text: textForMessageStreamItem(item),
    turnId,
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    activityKind: STEERING_ACTIVITY_KIND,
    toolName: STEERING_ACTIVITY_LABEL,
  };
}

function isCompletedTurnDetailItem(classification: PresentationClassification, turnOutcomeIdByTurn: Map<string, string>): boolean {
  const { item, semanticKind } = classification;
  if (!item.turnId || semanticKind === "userPrompt" || semanticKind === "steering") return false;
  return turnOutcomeIdByTurn.get(item.turnId) !== item.id;
}

function turnOutcomeItemsByTurn(items: readonly PresentationClassification[]): Map<string, string> {
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

function editedFilesForTurns(items: readonly PresentationClassification[], workspaceRoot?: string | null): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const { item, semanticKind } of items) {
    if (!item.turnId || semanticKind !== "filePatch") continue;
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

function autoReviewSummariesForTurns(items: readonly PresentationClassification[]): Map<string, string[]> {
  const byTurn = new Map<string, string[]>();
  for (const { item, semanticKind } of items) {
    if (!item.turnId || semanticKind !== "reviewResult") continue;
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
  semanticKind: PresentationSemanticKind,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter((item) => item.semanticKind === semanticKind).length;
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
