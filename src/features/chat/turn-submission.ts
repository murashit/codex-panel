import type { PendingTurnStart } from "./chat-state";
import type { DisplayFileMention, DisplayItem, MessageDisplayItem } from "./display/types";
import { attachHookRunsToTurn } from "./hook-display";

export interface LocalUserMessageParams {
  id: string;
  text: string;
  turnId?: string;
  referencedThread?: MessageDisplayItem["referencedThread"];
  mentionedFiles?: readonly DisplayFileMention[];
}

export interface OptimisticTurnStartAckParams {
  items: readonly DisplayItem[];
  optimisticUserId: string;
  turnId: string;
  pendingTurnStart: PendingTurnStart | null;
}

export interface FailedTurnStartCleanupParams {
  items: readonly DisplayItem[];
  optimisticUserId: string | null;
  pendingTurnStart: PendingTurnStart | null;
}

export function localUserMessageItem(params: LocalUserMessageParams): MessageDisplayItem {
  const mentionedFiles = params.mentionedFiles ?? [];
  return {
    id: params.id,
    kind: "message",
    role: "user",
    text: params.text,
    copyText: params.text,
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(params.referencedThread ? { referencedThread: params.referencedThread } : {}),
    ...(mentionedFiles.length > 0 ? { mentionedFiles: [...mentionedFiles] } : {}),
    markdown: true,
  };
}

export function acknowledgeOptimisticTurnStart(params: OptimisticTurnStartAckParams): DisplayItem[] {
  const displayItems = params.items.map((item) => (item.id === params.optimisticUserId ? { ...item, turnId: params.turnId } : item));
  if (!params.pendingTurnStart) return displayItems;
  return attachHookRunsToTurn(
    displayItems,
    params.turnId,
    params.pendingTurnStart.promptSubmitHookItemIds,
    params.pendingTurnStart.anchorItemId,
  );
}

export function cleanupFailedTurnStart(params: FailedTurnStartCleanupParams): DisplayItem[] {
  const withoutOptimisticUser = params.optimisticUserId
    ? params.items.filter((item) => item.id !== params.optimisticUserId)
    : [...params.items];
  if (!params.pendingTurnStart) return withoutOptimisticUser;
  const hookIds = new Set(params.pendingTurnStart.promptSubmitHookItemIds);
  return withoutOptimisticUser.filter((item) => !hookIds.has(item.id));
}
