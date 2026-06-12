import { normalizeProposedPlanMarkdown } from "../display/items/proposed-plan";
import { isAssistantAuthoredMessage } from "../display/predicates";
import type { AssistantAuthoredMessageDisplayItem, DisplayFileChange, DisplayItem, DisplayKind } from "../display/types";

export function upsertDisplayItem(items: readonly DisplayItem[], next: DisplayItem): DisplayItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  const previous = copy[index];
  if (previous === undefined) return [...items];
  copy[index] = {
    ...previous,
    ...next,
    output: mergeOutput(previous, next),
    changes: mergeChanges(previous, next),
  } as DisplayItem;
  return copy;
}

function mergeOutput(previous: DisplayItem, next: DisplayItem): string | undefined {
  const previousOutput = "output" in previous ? previous.output : undefined;
  const nextOutput = "output" in next ? next.output : undefined;
  return nextOutput && nextOutput.length > 0 ? nextOutput : previousOutput;
}

function mergeChanges(previous: DisplayItem, next: DisplayItem): DisplayFileChange[] | undefined {
  const previousChanges = previous.kind === "fileChange" ? previous.changes : undefined;
  const nextChanges = next.kind === "fileChange" ? next.changes : undefined;
  return nextChanges && nextChanges.length > 0 ? nextChanges : previousChanges;
}

export function appendAssistantDelta(items: readonly DisplayItem[], sourceItemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex(
    (item) => item.sourceItemId === sourceItemId && item.kind === "message" && item.messageKind === "assistantResponse",
  );
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && item.kind === "message" && item.messageKind === "assistantResponse"
        ? {
            ...item,
            text: `${item.text}${delta}`,
            copyText: `${item.text}${delta}`,
            turnId: item.turnId ?? turnId,
            messageState: "streaming",
          }
        : item,
    );
  }
  return [
    ...items,
    {
      id: sourceItemId,
      kind: "message",
      messageKind: "assistantResponse",
      role: "assistant",
      text: delta,
      copyText: delta,
      turnId,
      sourceItemId,
      messageState: "streaming",
    },
  ];
}

export function completeReasoningItems(items: readonly DisplayItem[], turnId: string): DisplayItem[] {
  return items.map((item) =>
    item.kind === "reasoning" && item.turnId === turnId
      ? {
          ...item,
          status: "completed",
          executionState: "completed",
        }
      : item,
  );
}

export function appendPlanDelta(items: readonly DisplayItem[], sourceItemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId && isAssistantAuthoredMessage(item));
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && isAssistantAuthoredMessage(item) ? appendPlanDeltaToMessage(item, turnId, delta) : item,
    );
  }
  const text = normalizeProposedPlanMarkdown(delta);
  return [
    ...items,
    {
      id: sourceItemId,
      kind: "message",
      messageKind: "proposedPlan",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      sourceItemId,
      messageState: "streaming",
    },
  ];
}

function appendPlanDeltaToMessage(item: AssistantAuthoredMessageDisplayItem, turnId: string, delta: string): DisplayItem {
  const text = normalizeProposedPlanMarkdown(`${item.text}${delta}`);
  return {
    ...item,
    messageKind: "proposedPlan",
    text,
    copyText: text,
    turnId: item.turnId ?? turnId,
    messageState: "streaming",
  };
}

export function appendItemText(
  items: readonly DisplayItem[],
  sourceItemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
): DisplayItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId);
  if (index !== -1) {
    return items.map((item, itemIndex) => (itemIndex === index ? { ...item, text: `${item.text}${delta}` } : item));
  }
  return [
    ...items,
    {
      id: sourceItemId,
      kind,
      role: "tool",
      text: `${label}: ${delta}`,
      turnId,
      sourceItemId,
    },
  ];
}

export function appendToolOutput(
  items: readonly DisplayItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId);
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && (item.kind === "tool" || item.kind === "hook" || item.kind === "reasoning")
        ? { ...item, output: `${item.output ?? ""}${delta}` }
        : item,
    );
  }
  return [
    ...items,
    {
      id: sourceItemId,
      kind: "tool",
      role: "tool",
      text: "details",
      toolLabel: fallbackLabel,
      turnId,
      sourceItemId,
      output: delta,
    },
  ];
}

export function appendItemOutput(
  items: readonly DisplayItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId);
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && (item.kind === "command" || item.kind === "fileChange")
        ? { ...item, output: `${item.output ?? ""}${delta}` }
        : item,
    );
  }
  return [
    ...items,
    {
      id: sourceItemId,
      kind,
      role: "tool",
      text: fallbackText,
      turnId,
      sourceItemId,
      output: delta,
      ...(kind === "fileChange"
        ? {
            status: "inProgress",
            changes: [],
            executionState: "running",
          }
        : {
            command: fallbackText,
            cwd: "(unknown)",
            status: "running",
            executionState: "running",
          }),
    },
  ] as DisplayItem[];
}

export function attachHookRunsToTurn(
  items: readonly DisplayItem[],
  turnId: string,
  hookItemIds: readonly string[],
  afterItemId?: string | null,
): DisplayItem[] {
  const hookIdSet = new Set(hookItemIds);
  const attachedHooks = items.filter((item) => hookIdSet.has(item.id)).map((item) => ({ ...item, turnId }));
  if (attachedHooks.length === 0) return [...items];

  const withoutAttachedHooks = items.filter((item) => !hookIdSet.has(item.id));
  const anchorItemId = afterItemId ?? lastUserMessageAnchorId(withoutAttachedHooks, turnId);
  if (!anchorItemId) return [...withoutAttachedHooks, ...attachedHooks];
  const insertAfterIndex = withoutAttachedHooks.findIndex((item) => item.id === anchorItemId);
  if (insertAfterIndex === -1) return [...withoutAttachedHooks, ...attachedHooks];
  return [...withoutAttachedHooks.slice(0, insertAfterIndex + 1), ...attachedHooks, ...withoutAttachedHooks.slice(insertAfterIndex + 1)];
}

function lastUserMessageAnchorId(items: readonly DisplayItem[], turnId: string): string | null {
  const anchor = [...items]
    .reverse()
    .find((item) => item.kind === "message" && item.role === "user" && (!item.turnId || item.turnId === turnId));
  return anchor?.id ?? null;
}
