import { normalizeProposedPlanMarkdown } from "./format/proposed-plan";
import { isAssistantAuthoredMessage } from "./selectors";
import { messageStreamIsTurnInitiator, messageStreamSemanticClassifications } from "./semantics";
import {
  streamedItemOutputMessageStreamItem,
  streamedTextMessageStreamItem,
  streamedToolOutputMessageStreamItem,
} from "./factories/streaming-items";
import type { AssistantAuthoredMessageStreamItem, MessageStreamFileChange, MessageStreamItem, MessageStreamItemKind } from "./items";

export function upsertMessageStreamItemById(items: readonly MessageStreamItem[], next: MessageStreamItem): MessageStreamItem[] {
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
  } as MessageStreamItem;
  return copy;
}

function mergeOutput(previous: MessageStreamItem, next: MessageStreamItem): string | undefined {
  const previousOutput = "output" in previous ? previous.output : undefined;
  const nextOutput = "output" in next ? next.output : undefined;
  return nextOutput && nextOutput.length > 0 ? nextOutput : previousOutput;
}

function mergeChanges(previous: MessageStreamItem, next: MessageStreamItem): MessageStreamFileChange[] | undefined {
  const previousChanges = previous.kind === "fileChange" ? previous.changes : undefined;
  const nextChanges = next.kind === "fileChange" ? next.changes : undefined;
  return nextChanges && nextChanges.length > 0 ? nextChanges : previousChanges;
}

export function appendAssistantDelta(
  items: readonly MessageStreamItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
): MessageStreamItem[] {
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
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      messageState: "streaming",
    },
  ];
}

export function completeReasoningItems(items: readonly MessageStreamItem[], turnId: string): MessageStreamItem[] {
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

export function appendPlanDelta(
  items: readonly MessageStreamItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
): MessageStreamItem[] {
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
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      messageState: "streaming",
    },
  ];
}

function appendPlanDeltaToMessage(item: AssistantAuthoredMessageStreamItem, turnId: string, delta: string): MessageStreamItem {
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
  items: readonly MessageStreamItem[],
  sourceItemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<MessageStreamItemKind, "tool" | "hook" | "reasoning"> = "tool",
): MessageStreamItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId);
  if (index !== -1) {
    return items.map((item, itemIndex) => (itemIndex === index ? { ...item, text: `${"text" in item ? item.text : ""}${delta}` } : item));
  }
  return [...items, streamedTextMessageStreamItem({ id: sourceItemId, kind, label, delta, turnId })];
}

export function appendToolOutput(
  items: readonly MessageStreamItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): MessageStreamItem[] {
  const index = items.findIndex((item) => item.sourceItemId === sourceItemId);
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && (item.kind === "tool" || item.kind === "hook" || item.kind === "reasoning")
        ? { ...item, output: `${item.output ?? ""}${delta}` }
        : item,
    );
  }
  return [...items, streamedToolOutputMessageStreamItem({ id: sourceItemId, turnId, output: delta, fallbackLabel })];
}

export function appendItemOutput(
  items: readonly MessageStreamItem[],
  sourceItemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): MessageStreamItem[] {
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
    streamedItemOutputMessageStreamItem({ id: sourceItemId, kind, turnId, output: delta, fallbackText }),
  ] as MessageStreamItem[];
}

export function attachHookRunsToTurn(
  items: readonly MessageStreamItem[],
  turnId: string,
  hookItemIds: readonly string[],
  afterItemId?: string | null,
): MessageStreamItem[] {
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

function lastUserMessageAnchorId(items: readonly MessageStreamItem[], turnId: string): string | null {
  const anchor = [...messageStreamSemanticClassifications(items)]
    .reverse()
    .find(
      (classification) =>
        messageStreamIsTurnInitiator(classification) && (!classification.item.turnId || classification.item.turnId === turnId),
    );
  return anchor?.item.id ?? null;
}
