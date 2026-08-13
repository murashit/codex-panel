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

  const serverUserDialogueClientIds = new Set(turnItems.flatMap((item) => (isUserDialogue(item) && item.clientId ? [item.clientId] : [])));
  const localMetadataByClientId = new Map<string, LocalDialogueMetadata>();
  const localMetadataByFallbackText = new Map<string, LocalDialogueMetadata>();
  for (const item of currentItems) {
    if (!isOptimisticUserDialogue(item)) continue;
    localMetadataByClientId.set(optimisticDialogueClientId(item), {
      contextAttachments: item.contextAttachments,
      referencedFiles: item.referencedFiles,
      referencedThread: item.referencedThread,
    });
    if (serverUserDialogueClientIds.size > 0 || (!item.contextAttachments && !item.referencedFiles)) continue;
    if (item.turnId && item.turnId !== completedTurnId) continue;
    localMetadataByFallbackText.set(item.copyText ?? item.text, {
      contextAttachments: item.contextAttachments,
      referencedFiles: item.referencedFiles,
    });
  }
  const turnItemsWithLocalContext = turnItems.map((item) => {
    if (!isUserDialogue(item)) return item;
    const localMetadata = item.clientId ? localMetadataByClientId.get(item.clientId) : undefined;
    const fallbackMetadata = localMetadataByFallbackText.get(item.copyText ?? item.text);
    const contextAttachments = item.contextAttachments ?? localMetadata?.contextAttachments ?? fallbackMetadata?.contextAttachments;
    const referencedFiles = item.referencedFiles ?? localMetadata?.referencedFiles ?? fallbackMetadata?.referencedFiles;
    const referencedThread = item.referencedThread
      ? { ...item.referencedThread, ...(localMetadata?.referencedThread ? { title: localMetadata.referencedThread.title } : {}) }
      : localMetadata?.referencedThread;
    return {
      ...item,
      ...(contextAttachments ? { contextAttachments } : {}),
      ...(referencedFiles ? { referencedFiles } : {}),
      ...(referencedThread ? { referencedThread } : {}),
    };
  });

  const serverUserDialoguesByClientId = new Map<string, ThreadStreamDialogueItem & { role: "user" }>();
  const serverUserDialogueFallbackTexts = new Set<string>();
  for (const item of turnItemsWithLocalContext) {
    if (!isUserDialogue(item)) continue;
    if (item.clientId) serverUserDialoguesByClientId.set(item.clientId, item);
    else if (serverUserDialogueClientIds.size === 0) serverUserDialogueFallbackTexts.add(item.text);
  }
  const currentWithServerDialogues = currentItems.map(
    (item) => serverUserDialogueForOptimisticItem(item, serverUserDialoguesByClientId) ?? item,
  );

  const retainedItems: ThreadStreamItem[] = [];
  let mergedTurnItems: ThreadStreamItem[] = [];
  for (const item of currentWithServerDialogues) {
    if (isReconciledOptimisticUserDialogue(item, completedTurnId, serverUserDialogueClientIds, serverUserDialogueFallbackTexts)) continue;
    (item.turnId === completedTurnId ? mergedTurnItems : retainedItems).push(item);
  }
  for (const item of turnItemsWithLocalContext) {
    mergedTurnItems = upsertThreadStreamItemById(mergedTurnItems, item);
  }
  return [...retainedItems, ...mergedTurnItems];
}

interface LocalDialogueMetadata {
  contextAttachments?: ThreadStreamDialogueItem["contextAttachments"];
  referencedFiles?: ThreadStreamDialogueItem["referencedFiles"];
  referencedThread?: ThreadStreamDialogueItem["referencedThread"];
}

function isUserDialogue(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { role: "user" } {
  return item.kind === "dialogue" && item.role === "user";
}

function serverUserDialogueForOptimisticItem(
  item: ThreadStreamItem,
  serverUserDialoguesByClientId: ReadonlyMap<string, ThreadStreamDialogueItem & { role: "user" }>,
): (ThreadStreamDialogueItem & { role: "user" }) | null {
  if (!isOptimisticUserDialogue(item)) return null;
  return serverUserDialoguesByClientId.get(optimisticDialogueClientId(item)) ?? null;
}

function isReconciledOptimisticUserDialogue(
  item: ThreadStreamItem,
  completedTurnId: string,
  serverUserDialogueClientIds: Set<string>,
  serverUserDialogueFallbackTexts: Set<string>,
): boolean {
  if (!isOptimisticUserDialogue(item)) return false;
  return (
    serverUserDialogueClientIds.has(optimisticDialogueClientId(item)) ||
    isFallbackOptimisticUserDialogueForTurn(item, completedTurnId, serverUserDialogueFallbackTexts)
  );
}

function isOptimisticUserDialogue(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { role: "user" } {
  return (
    isUserDialogue(item) &&
    (isLocalUserDialogueId(item.id) || (item.provenance?.source === "localUser" && item.provenance.channel === "optimistic"))
  );
}

function optimisticDialogueClientId(item: ThreadStreamDialogueItem): string {
  return item.clientId ?? item.id;
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
