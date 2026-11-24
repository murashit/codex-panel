import type { ThreadStreamItem, UserThreadStreamDialogueItem } from "./items";
import { isOptimisticUserDialogue, optimisticDialogueClientId } from "./local-dialogue-ids";
import { isEquivalentTurnErrorNotice, isTerminalTurnErrorItem } from "./turn-error-notices";
import { upsertThreadStreamItemById, userDialogueWithLocalContext } from "./updates";

export interface CompletedTurnReconciliationInput {
  currentItems: readonly ThreadStreamItem[];
  completedTurnId: string;
  turnItems: readonly ThreadStreamItem[];
}

export function reconcileCompletedTurnItems(input: CompletedTurnReconciliationInput): readonly ThreadStreamItem[] {
  const { completedTurnId, turnItems } = input;
  const terminalErrorItem = turnItems.find((item) => item.turnId === completedTurnId && isTerminalTurnErrorItem(item));
  const currentItems = terminalErrorItem
    ? input.currentItems.filter((item) => item.id !== terminalErrorItem.id && !isEquivalentTurnErrorNotice(item, terminalErrorItem))
    : input.currentItems;
  if (turnItems.length === 0) return currentItems;

  const matchByClientId = turnItems.some((item) => item.kind === "dialogue" && item.role === "user" && item.clientId);
  const localDialogues = new Map<string, UserThreadStreamDialogueItem>();
  for (const item of currentItems) {
    if (!isOptimisticUserDialogue(item)) continue;
    if (matchByClientId) localDialogues.set(optimisticDialogueClientId(item), item);
    else if ((!item.turnId || item.turnId === completedTurnId) && (item.contextAttachments || item.referencedFiles)) {
      localDialogues.set(item.copyText ?? item.text, item);
    }
  }

  const serverByClientId = new Map<string, UserThreadStreamDialogueItem>();
  const fallbackTexts = new Set<string>();
  const turnItemsWithLocalContext = turnItems.map((item) => {
    if (item.kind !== "dialogue" || item.role !== "user") return item;
    const key = matchByClientId ? item.clientId || undefined : (item.copyText ?? item.text);
    const canonical = userDialogueWithLocalContext(item, key === undefined ? undefined : localDialogues.get(key));
    if (item.clientId) serverByClientId.set(item.clientId, canonical);
    else if (!matchByClientId) fallbackTexts.add(item.text);
    return canonical;
  });

  const retainedItems: ThreadStreamItem[] = [];
  let mergedTurnItems: ThreadStreamItem[] = [];
  for (const current of currentItems) {
    let item = current;
    if (isOptimisticUserDialogue(current)) {
      const server = serverByClientId.get(optimisticDialogueClientId(current));
      if (server) {
        if (isOptimisticUserDialogue(server)) continue;
        item = server;
      } else if ((!current.turnId || current.turnId === completedTurnId) && fallbackTexts.has(current.copyText ?? current.text)) continue;
    }
    (item.turnId === completedTurnId ? mergedTurnItems : retainedItems).push(item);
  }
  for (const item of turnItemsWithLocalContext) {
    mergedTurnItems = upsertThreadStreamItemById(mergedTurnItems, item);
  }
  return [...retainedItems, ...mergedTurnItems];
}
