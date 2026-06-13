import type { PendingTurnStart } from "../../state/reducer";
import type { MessageStreamFileMention, MessageStreamItem, MessageStreamMessageItem } from "../../message-stream/items";
import { fileMentionsFromInput, userMessageDisplayText } from "../../display/items/message-content";
import { attachHookRunsToTurn } from "../../state/message-stream-updates";
import type { CodexInput } from "../../../../domain/chat/input";

export interface LocalUserMessageParams {
  id: string;
  text: string;
  copyText?: string;
  turnId?: string;
  referencedThread?: MessageStreamMessageItem["referencedThread"];
  mentionedFiles?: readonly MessageStreamFileMention[];
}

export interface OptimisticTurnStartAckParams {
  items: readonly MessageStreamItem[];
  optimisticUserId: string;
  turnId: string;
  pendingTurnStart: PendingTurnStart | null;
}

export interface LocalUserMessageFromInputParams extends Omit<LocalUserMessageParams, "mentionedFiles"> {
  codexInput: CodexInput;
}

export type OptimisticTurnStartParams = LocalUserMessageFromInputParams;

export interface OptimisticTurnStart {
  item: MessageStreamMessageItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAckMatchParams {
  expectedThreadId: string;
  activeThreadId: string | null;
  pendingTurnStart: PendingTurnStart | null;
  activeTurnId: string | null;
  optimisticUserId: string;
  responseTurnId: string;
}

export interface FailedTurnStartCleanupParams {
  items: readonly MessageStreamItem[];
  optimisticUserId: string | null;
  pendingTurnStart: PendingTurnStart | null;
}

export function localUserMessageItem(params: LocalUserMessageParams): MessageStreamMessageItem {
  const mentionedFiles = params.mentionedFiles ?? [];
  return {
    id: params.id,
    kind: "message",
    messageKind: "user",
    role: "user",
    text: params.text,
    copyText: params.copyText ?? params.text,
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(params.referencedThread ? { referencedThread: params.referencedThread } : {}),
    ...(mentionedFiles.length > 0 ? { mentionedFiles: [...mentionedFiles] } : {}),
  };
}

export function localUserMessageItemFromInput(params: LocalUserMessageFromInputParams): MessageStreamMessageItem {
  return localUserMessageItem({
    id: params.id,
    text: userMessageDisplayText(params.text, params.codexInput),
    copyText: params.text,
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
  if (params.activeThreadId !== params.expectedThreadId) return false;
  return (
    params.pendingTurnStart?.anchorItemId === params.optimisticUserId ||
    (!params.pendingTurnStart && params.activeTurnId === params.responseTurnId)
  );
}

export function acknowledgeOptimisticTurnStart(params: OptimisticTurnStartAckParams): MessageStreamItem[] {
  const items = params.items.map((item) => (item.id === params.optimisticUserId ? { ...item, turnId: params.turnId } : item));
  if (!params.pendingTurnStart) return items;
  return attachHookRunsToTurn(items, params.turnId, params.pendingTurnStart.promptSubmitHookItemIds, params.pendingTurnStart.anchorItemId);
}

export function cleanupFailedTurnStart(params: FailedTurnStartCleanupParams): MessageStreamItem[] {
  const withoutOptimisticUser = params.optimisticUserId
    ? params.items.filter((item) => item.id !== params.optimisticUserId)
    : [...params.items];
  if (!params.pendingTurnStart) return withoutOptimisticUser;
  const hookIds = new Set(params.pendingTurnStart.promptSubmitHookItemIds);
  return withoutOptimisticUser.filter((item) => !hookIds.has(item.id));
}
