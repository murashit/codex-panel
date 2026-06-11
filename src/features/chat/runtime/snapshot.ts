import type { ChatState } from "../state/reducer";
import type { RuntimeSnapshot } from "./model";

interface RuntimeSnapshotInput {
  runtimeConfig: ChatState["connection"]["runtimeConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  displayItems: ChatState["transcript"]["displayItems"];
  availableModels: ChatState["connection"]["availableModels"];
}

function runtimeSnapshotForChatSlices(input: RuntimeSnapshotInput): RuntimeSnapshot {
  return {
    runtimeConfig: input.runtimeConfig,
    activeThreadId: input.activeThread.id,
    activeModel: input.runtime.activeModel,
    activeReasoningEffort: input.runtime.activeReasoningEffort,
    activeCollaborationMode: input.runtime.activeCollaborationMode,
    activeServiceTier: input.runtime.activeServiceTier,
    activeApprovalPolicy: input.runtime.activeApprovalPolicy,
    activeApprovalsReviewer: input.runtime.activeApprovalsReviewer,
    activePermissionProfile: input.runtime.activePermissionProfile,
    requestedModel: input.runtime.requestedModel,
    requestedReasoningEffort: input.runtime.requestedReasoningEffort,
    requestedApprovalsReviewer: input.runtime.requestedApprovalsReviewer,
    selectedCollaborationMode: input.runtime.selectedCollaborationMode,
    requestedServiceTier: input.runtime.requestedServiceTier,
    tokenUsage: input.activeThread.tokenUsage,
    rateLimit: input.rateLimit,
    hasThreadTurns: input.displayItems.some((item) => item.turnId),
    availableModels: input.availableModels,
  };
}

export function runtimeSnapshotForChatState(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    displayItems: state.transcript.displayItems,
    availableModels: state.connection.availableModels,
  });
}
