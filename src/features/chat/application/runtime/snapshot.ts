import type { ChatState } from "../state/root-reducer";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { messageStreamItems } from "../state/message-stream";

interface RuntimeSnapshotInput {
  runtimeConfig: ChatState["connection"]["runtimeConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  hasThreadTurns: boolean;
  availableModels: ChatState["connection"]["availableModels"];
}

export function messageItemsHaveThreadTurns(items: readonly MessageStreamItem[]): boolean {
  return items.some((item) => item.turnId);
}

export function runtimeSnapshotForChatSlices(input: RuntimeSnapshotInput): RuntimeSnapshot {
  return {
    runtimeConfig: input.runtimeConfig,
    activeThreadId: input.activeThread.id,
    activeModel: input.runtime.activeModel,
    activeReasoningEffort: input.runtime.activeReasoningEffort,
    activeCollaborationMode: input.runtime.activeCollaborationMode,
    activeServiceTier: input.runtime.activeServiceTier,
    activeApprovalsReviewer: input.runtime.activeApprovalsReviewer,
    requestedModel: input.runtime.requestedModel,
    requestedReasoningEffort: input.runtime.requestedReasoningEffort,
    requestedApprovalsReviewer: input.runtime.requestedApprovalsReviewer,
    selectedCollaborationMode: input.runtime.selectedCollaborationMode,
    requestedFastMode: input.runtime.requestedFastMode,
    tokenUsage: input.activeThread.tokenUsage,
    rateLimit: input.rateLimit,
    hasThreadTurns: input.hasThreadTurns,
    availableModels: input.availableModels,
  };
}

export function runtimeSnapshotForChatState(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    hasThreadTurns: messageItemsHaveThreadTurns(messageStreamItems(state.messageStream)),
    availableModels: state.connection.availableModels,
  });
}
