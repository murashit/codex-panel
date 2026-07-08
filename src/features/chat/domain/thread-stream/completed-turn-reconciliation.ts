import type { ThreadStreamDialogueItem, ThreadStreamItem } from "./items";
import { isLocalUserDialogueId } from "./local-dialogue-ids";
import { upsertThreadStreamItemById } from "./updates";

export interface CompletedTurnReconciliationInput {
  currentItems: readonly ThreadStreamItem[];
  completedTurnId: string;
  turnItems: readonly ThreadStreamItem[];
}

export function reconcileCompletedTurnItems(input: CompletedTurnReconciliationInput): readonly ThreadStreamItem[] {
  const { currentItems, completedTurnId, turnItems } = input;
  if (turnItems.length === 0) return currentItems;

  const serverUserDialogues = turnItems.filter(isUserDialogue);
  const serverUserDialogueClientIds = new Set(serverUserDialogues.map((item) => item.clientId).filter(isString));
  const serverUserDialoguesByClientId = new Map(
    serverUserDialogues.flatMap((item) => (item.clientId ? ([[item.clientId, item]] as const) : [])),
  );
  const serverUserDialogueFallbackTexts =
    serverUserDialogueClientIds.size > 0 ? new Set<string>() : new Set(serverUserDialogues.map((item) => item.text));
  const currentWithServerDialogues = currentItems.map(
    (item) => serverUserDialogueForOptimisticItem(item, serverUserDialoguesByClientId) ?? item,
  );

  let mergedTurnItems = currentWithServerDialogues
    .filter((item) => item.turnId === completedTurnId)
    .filter(
      (item) => !isReconciledOptimisticUserDialogue(item, completedTurnId, serverUserDialogueClientIds, serverUserDialogueFallbackTexts),
    );
  for (const item of turnItems) {
    mergedTurnItems = upsertThreadStreamItemById(mergedTurnItems, item);
  }

  const retainedItems = currentWithServerDialogues
    .filter((item) => item.turnId !== completedTurnId)
    .filter(
      (item) => !isReconciledOptimisticUserDialogue(item, completedTurnId, serverUserDialogueClientIds, serverUserDialogueFallbackTexts),
    );
  return [...retainedItems, ...mergedTurnItems];
}

function isUserDialogue(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { role: "user" } {
  return item.kind === "dialogue" && item.role === "user";
}

function serverUserDialogueForOptimisticItem(
  item: ThreadStreamItem,
  serverUserDialoguesByClientId: ReadonlyMap<string, ThreadStreamDialogueItem & { role: "user" }>,
): (ThreadStreamDialogueItem & { role: "user" }) | null {
  if (!isUserDialogue(item) || !isLocalUserDialogueId(item.id)) return null;
  return serverUserDialoguesByClientId.get(item.id) ?? null;
}

function isReconciledOptimisticUserDialogue(
  item: ThreadStreamItem,
  completedTurnId: string,
  serverUserDialogueClientIds: Set<string>,
  serverUserDialogueFallbackTexts: Set<string>,
): boolean {
  if (!isUserDialogue(item) || !isLocalUserDialogueId(item.id)) return false;
  return (
    serverUserDialogueClientIds.has(item.id) ||
    isFallbackOptimisticUserDialogueForTurn(item, completedTurnId, serverUserDialogueFallbackTexts)
  );
}

function isFallbackOptimisticUserDialogueForTurn(
  item: ThreadStreamDialogueItem & { role: "user" },
  completedTurnId: string,
  serverUserDialogueFallbackTexts: Set<string>,
): boolean {
  if (serverUserDialogueFallbackTexts.size === 0) return false;
  if (item.turnId && item.turnId !== completedTurnId) return false;
  return serverUserDialogueFallbackTexts.has(item.copyText ?? item.text);
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string";
}
