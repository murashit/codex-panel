import type { ThreadStreamFileChange, ThreadStreamItem } from "./items";

export function upsertThreadStreamItemById(items: readonly ThreadStreamItem[], next: ThreadStreamItem): ThreadStreamItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  const previous = items[index] as ThreadStreamItem;
  copy[index] = mergeThreadStreamItem(previous, next);
  return copy;
}

export function mergeThreadStreamItem(previous: ThreadStreamItem, next: ThreadStreamItem): ThreadStreamItem {
  return {
    ...previous,
    ...next,
    output: mergeOutput(previous, next),
    changes: mergeChanges(previous, next),
  } as ThreadStreamItem;
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
      statusLabel: "Completed",
      executionState: "completed",
    } satisfies ThreadStreamItem);
  }
  return changed ? nextItems : items;
}
