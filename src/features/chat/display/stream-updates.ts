import type { AssistantAuthoredMessageDisplayItem, DisplayFileChange, DisplayItem, DisplayKind } from "./types";
import { isAssistantAuthoredMessage } from "./turn-outcome-message";
import { normalizeProposedPlanMarkdown } from "./plan";

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

export function appendAssistantDelta(items: readonly DisplayItem[], itemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId && item.kind === "message" && item.messageKind === "assistantResponse");
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
      id: itemId,
      kind: "message",
      messageKind: "assistantResponse",
      role: "assistant",
      text: delta,
      copyText: delta,
      turnId,
      itemId,
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

export function appendPlanDelta(items: readonly DisplayItem[], itemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId && isAssistantAuthoredMessage(item));
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && isAssistantAuthoredMessage(item) ? appendPlanDeltaToMessage(item, turnId, delta) : item,
    );
  }
  const text = normalizeProposedPlanMarkdown(delta);
  return [
    ...items,
    {
      id: itemId,
      kind: "message",
      messageKind: "proposedPlan",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      itemId,
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
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
  if (index !== -1) {
    return items.map((item, itemIndex) => (itemIndex === index ? { ...item, text: `${item.text}${delta}` } : item));
  }
  return [
    ...items,
    {
      id: itemId,
      kind,
      role: "tool",
      text: `${label}: ${delta}`,
      turnId,
      itemId,
    },
  ];
}

export function appendToolOutput(
  items: readonly DisplayItem[],
  itemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
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
      id: itemId,
      kind: "tool",
      role: "tool",
      text: "details",
      toolLabel: fallbackLabel,
      turnId,
      itemId,
      output: delta,
    },
  ];
}

export function appendItemOutput(
  items: readonly DisplayItem[],
  itemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
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
      id: itemId,
      kind,
      role: "tool",
      text: fallbackText,
      turnId,
      itemId,
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
