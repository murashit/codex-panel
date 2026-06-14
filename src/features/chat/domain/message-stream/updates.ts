import { messageStreamIsTurnInitiator, messageStreamSemanticClassifications } from "./semantics";
import type { MessageStreamFileChange, MessageStreamItem } from "./items";

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
