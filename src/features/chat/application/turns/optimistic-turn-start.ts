import type { CodexInput } from "../../../../domain/chat/input";
import { contextAttachmentsFromInput } from "../../domain/thread-stream/format/context-attachments";
import { fileMentionsFromInput } from "../../domain/thread-stream/format/file-mentions";
import { userMessageDisplayText } from "../../domain/thread-stream/format/user-message-text";
import type { ThreadStreamDialogueItem, ThreadStreamFileMention, ThreadStreamItem } from "../../domain/thread-stream/items";
import { isLocalSteerDialogueClientId } from "../../domain/thread-stream/local-dialogue-ids";
import type { ThreadStreamItemProvenance } from "../../domain/thread-stream/provenance";
import { attachHookRunsToTurn } from "../../domain/thread-stream/updates";
import type { PendingTurnStart } from "./turn-state";

interface LocalUserDialogueParams {
  id: string;
  text: string;
  copyText?: string;
  turnId?: string;
  referencedThread?: ThreadStreamDialogueItem["referencedThread"];
  mentionedFiles?: readonly ThreadStreamFileMention[];
  contextAttachments?: ThreadStreamDialogueItem["contextAttachments"];
}

export interface OptimisticTurnStartAckParams {
  items: readonly ThreadStreamItem[];
  optimisticUserId: string;
  turnId: string;
  pendingTurnStart: PendingTurnStart | null;
}

export interface LocalUserDialogueFromInputParams extends Omit<LocalUserDialogueParams, "mentionedFiles"> {
  codexInput: CodexInput;
}

export interface OptimisticTurnStart {
  item: ThreadStreamDialogueItem;
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
  items: readonly ThreadStreamItem[];
  optimisticUserId: string | null;
  pendingTurnStart: PendingTurnStart | null;
}

function localUserDialogueItem(params: LocalUserDialogueParams): ThreadStreamDialogueItem {
  const mentionedFiles = params.mentionedFiles ?? [];
  const contextAttachments = params.contextAttachments ?? [];
  return {
    id: params.id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text: params.text,
    copyText: params.copyText ?? params.text,
    provenance: localUserDialogueProvenance(params.id),
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(params.referencedThread ? { referencedThread: params.referencedThread } : {}),
    ...(mentionedFiles.length > 0 ? { mentionedFiles: [...mentionedFiles] } : {}),
    ...(contextAttachments.length > 0 ? { contextAttachments: [...contextAttachments] } : {}),
  };
}

function localUserDialogueProvenance(id: string): ThreadStreamItemProvenance {
  return {
    source: "localUser",
    channel: "optimistic",
    interaction: isLocalSteerDialogueClientId(id) ? "steer" : "prompt",
    sourceId: id,
  };
}

export function localUserDialogueItemFromInput(params: LocalUserDialogueFromInputParams): ThreadStreamDialogueItem {
  return localUserDialogueItem({
    id: params.id,
    text: userMessageDisplayText(params.text, params.codexInput),
    copyText: params.text,
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(params.referencedThread ? { referencedThread: params.referencedThread } : {}),
    mentionedFiles: fileMentionsFromInput([...params.codexInput]),
    contextAttachments: contextAttachmentsFromInput(params.codexInput),
  });
}

export function optimisticTurnStart(params: LocalUserDialogueFromInputParams): OptimisticTurnStart {
  return {
    item: localUserDialogueItemFromInput(params),
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

export function acknowledgeOptimisticTurnStart(params: OptimisticTurnStartAckParams): ThreadStreamItem[] {
  const items = params.items.map((item) => (item.id === params.optimisticUserId ? { ...item, turnId: params.turnId } : item));
  if (!params.pendingTurnStart) return items;
  return attachHookRunsToTurn(items, params.turnId, params.pendingTurnStart.promptSubmitHookItemIds, params.pendingTurnStart.anchorItemId);
}

export function cleanupFailedTurnStart(params: FailedTurnStartCleanupParams): ThreadStreamItem[] {
  const withoutOptimisticUser = params.optimisticUserId
    ? params.items.filter((item) => item.id !== params.optimisticUserId)
    : [...params.items];
  if (!params.pendingTurnStart) return withoutOptimisticUser;
  const hookIds = new Set(params.pendingTurnStart.promptSubmitHookItemIds);
  return withoutOptimisticUser.filter((item) => !hookIds.has(item.id));
}
