import type { ModelMetadata, ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { ActiveCollaborationMode, CollaborationMode, PendingRuntimeSetting, RequestedServiceTier } from "./pending-settings";

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
