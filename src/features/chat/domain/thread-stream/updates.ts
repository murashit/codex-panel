import type { ThreadStreamFileChange, ThreadStreamItem, UserThreadStreamDialogueItem } from "./items";

export function userDialogueWithLocalContext(
  item: UserThreadStreamDialogueItem,
  local: UserThreadStreamDialogueItem | undefined,
  pending?: UserThreadStreamDialogueItem,
): UserThreadStreamDialogueItem {
  const contextAttachments = item.contextAttachments ?? local?.contextAttachments ?? pending?.contextAttachments;
  const referencedFiles = item.referencedFiles ?? local?.referencedFiles ?? pending?.referencedFiles;
  return {
    ...item,
    ...(contextAttachments ? { contextAttachments } : {}),
    ...(referencedFiles ? { referencedFiles } : {}),
  };
}

export function upsertThreadStreamItemById(items: readonly ThreadStreamItem[], next: ThreadStreamItem): ThreadStreamItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  const previous = items[index];
  if (!previous) return [...items, next];
  const copy = [...items];
  copy[index] = mergeThreadStreamItem(previous, next);
  return copy;
}

export function mergeThreadStreamItem(previous: ThreadStreamItem, next: ThreadStreamItem): ThreadStreamItem {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Same-identity items retain their variant. Omitted snapshot fields preserve known display data, including Panel-owned reasoning completion; the overlays retain streamed output and changes.
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
    if (item.kind !== "reasoning" || item.turnId !== turnId || (item.executionState === "completed" && item.statusLabel === "Completed")) {
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
