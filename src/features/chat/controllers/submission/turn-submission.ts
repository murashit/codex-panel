import type { PendingTurnStart } from "../../chat-state";
import type { DisplayFileMention, DisplayItem, MessageDisplayItem } from "../../display/types";
import { fileMentionsFromInput } from "../../display/thread-items";
import { attachHookRunsToTurn } from "../../hook-display";
import type { UserInput } from "../../../../generated/app-server/v2/UserInput";

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

export interface LocalUserMessageFromInputParams extends Omit<LocalUserMessageParams, "mentionedFiles"> {
  codexInput: readonly UserInput[];
}

export type OptimisticTurnStartParams = LocalUserMessageFromInputParams;

export interface OptimisticTurnStart {
  item: MessageDisplayItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAckMatchParams {
  pendingTurnStart: PendingTurnStart | null;
  activeTurnId: string | null;
  optimisticUserId: string;
  responseTurnId: string;
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

export function localUserMessageItemFromInput(params: LocalUserMessageFromInputParams): MessageDisplayItem {
  return localUserMessageItem({
    id: params.id,
    text: params.text,
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(params.referencedThread ? { referencedThread: params.referencedThread } : {}),
    mentionedFiles: fileMentionsFromInput([...params.codexInput]),
  });
}

export function optimisticTurnStart(params: OptimisticTurnStartParams): OptimisticTurnStart {
  return {
    item: localUserMessageItemFromInput(params),
    pendingTurnStart: { anchorItemId: params.id, promptSubmitHookItemIds: [] },
  };
}

export function shouldAcknowledgeTurnStart(params: TurnStartAckMatchParams): boolean {
  return (
    params.pendingTurnStart?.anchorItemId === params.optimisticUserId ||
    (!params.pendingTurnStart && params.activeTurnId === params.responseTurnId)
  );
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
