import type { ThreadStreamFileChange, ThreadStreamItem } from "./items";
import { threadStreamSemanticClassifications } from "./semantics/classify";
import { threadStreamIsTurnInitiator } from "./semantics/predicates";

export function upsertThreadStreamItemById(items: readonly ThreadStreamItem[], next: ThreadStreamItem): ThreadStreamItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  const previous = items[index] as ThreadStreamItem;
  copy[index] = {
    ...previous,
    ...next,
    output: mergeOutput(previous, next),
    changes: mergeChanges(previous, next),
  } as ThreadStreamItem;
  return copy;
}

function mergeOutput(previous: ThreadStreamItem, next: ThreadStreamItem): string | undefined {
  const previousOutput = "output" in previous ? previous.output : undefined;
  const nextOutput = "output" in next ? next.output : undefined;
  return nextOutput || previousOutput;
}

function mergeChanges(previous: ThreadStreamItem, next: ThreadStreamItem): readonly ThreadStreamFileChange[] | undefined {
  const previousChanges = previous.kind === "fileChange" ? previous.changes : undefined;
  const nextChanges = next.kind === "fileChange" ? next.changes : undefined;
  return nextChanges && nextChanges.length > 0 ? nextChanges : previousChanges;
}

export function completeReasoningItems(items: readonly ThreadStreamItem[], turnId: string): readonly ThreadStreamItem[] {
  let changed = false;
  const nextItems: ThreadStreamItem[] = [];
  for (const item of items) {
    if (item.kind !== "reasoning" || item.turnId !== turnId) {
      nextItems.push(item);
      continue;
    }
    changed = true;
    nextItems.push({
      ...item,
      status: "completed",
      executionState: "completed",
    } satisfies ThreadStreamItem);
  }
  return changed ? nextItems : items;
}

export function attachHookRunsToTurn(
  items: readonly ThreadStreamItem[],
  turnId: string,
  hookItemIds: readonly string[],
  afterItemId?: string | null,
): ThreadStreamItem[] {
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

function lastUserMessageAnchorId(items: readonly ThreadStreamItem[], turnId: string): string | null {
  const anchor = [...threadStreamSemanticClassifications(items)]
    .reverse()
    .find(
      (classification) =>
        threadStreamIsTurnInitiator(classification) && (!classification.item.turnId || classification.item.turnId === turnId),
    );
  return anchor?.item.id ?? null;
}
