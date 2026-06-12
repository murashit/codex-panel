import type { ChatState } from "../state/reducer";
import type { RuntimeConfigSnapshot } from "../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../domain/runtime/metrics";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../../domain/runtime/policy";
import type { ModelMetadata, ReasoningEffort } from "../../../domain/catalog/metadata";
import type { ActiveCollaborationMode, CollaborationMode, PendingRuntimeSetting, RequestedServiceTier } from "./pending-settings";
import type { DisplayItem } from "../display/types";
import { messageStreamDisplayItems } from "../state/message-stream";

export interface RuntimeSnapshot {
  runtimeConfig: RuntimeConfigSnapshot | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ActiveCollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: ApprovalPolicy | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: CollaborationMode;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly ModelMetadata[];
}

interface RuntimeSnapshotInput {
  runtimeConfig: ChatState["connection"]["runtimeConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  displayItems: readonly DisplayItem[];
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
    displayItems: messageStreamDisplayItems(state.messageStream),
    availableModels: state.connection.availableModels,
  });
}
