import type { MessageStreamItem, MessageStreamMessageItem } from "./items";
import { isLocalUserMessageId } from "./local-message-ids";
import { upsertMessageStreamItemById } from "./updates";

export interface CompletedTurnReconciliationInput {
  currentItems: readonly MessageStreamItem[];
  completedTurnId: string;
  turnItems: readonly MessageStreamItem[];
}

export function reconcileCompletedTurnItems(input: CompletedTurnReconciliationInput): readonly MessageStreamItem[] {
  const { currentItems, completedTurnId, turnItems } = input;
  if (turnItems.length === 0) return currentItems;

  const serverUserMessages = turnItems.filter(isUserMessage);
  const serverUserClientIds = new Set(serverUserMessages.map((item) => item.clientId).filter(isString));
  const serverUserMessagesByClientId = new Map(
    serverUserMessages.flatMap((item) => (item.clientId ? ([[item.clientId, item]] as const) : [])),
  );
  const serverUserFallbackTexts = serverUserClientIds.size > 0 ? new Set<string>() : new Set(serverUserMessages.map((item) => item.text));
  const currentWithServerUsers = currentItems.map((item) => serverUserMessageForOptimisticItem(item, serverUserMessagesByClientId) ?? item);

  let mergedTurnItems = currentWithServerUsers
    .filter((item) => item.turnId === completedTurnId)
    .filter((item) => !isReconciledOptimisticUserMessage(item, completedTurnId, serverUserClientIds, serverUserFallbackTexts));
  for (const item of turnItems) {
    mergedTurnItems = upsertMessageStreamItemById(mergedTurnItems, item);
  }

  const retainedItems = currentWithServerUsers
    .filter((item) => item.turnId !== completedTurnId)
    .filter((item) => !isReconciledOptimisticUserMessage(item, completedTurnId, serverUserClientIds, serverUserFallbackTexts));
  return [...retainedItems, ...mergedTurnItems];
}

function isUserMessage(item: MessageStreamItem): item is MessageStreamMessageItem & { role: "user" } {
  return item.kind === "message" && item.role === "user";
}

function serverUserMessageForOptimisticItem(
  item: MessageStreamItem,
  serverUserMessagesByClientId: ReadonlyMap<string, MessageStreamMessageItem & { role: "user" }>,
): (MessageStreamMessageItem & { role: "user" }) | null {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return null;
  return serverUserMessagesByClientId.get(item.id) ?? null;
}

function isReconciledOptimisticUserMessage(
  item: MessageStreamItem,
  completedTurnId: string,
  serverUserClientIds: Set<string>,
  serverUserFallbackTexts: Set<string>,
): boolean {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return false;
  return serverUserClientIds.has(item.id) || isFallbackOptimisticUserMessageForTurn(item, completedTurnId, serverUserFallbackTexts);
}

function isFallbackOptimisticUserMessageForTurn(
  item: MessageStreamMessageItem & { role: "user" },
  completedTurnId: string,
  serverUserFallbackTexts: Set<string>,
): boolean {
  if (serverUserFallbackTexts.size === 0) return false;
  if (item.turnId && item.turnId !== completedTurnId) return false;
  return serverUserFallbackTexts.has(item.copyText ?? item.text);
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string";
}
