import type { ModelMetadata, ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { ActiveCollaborationMode, CollaborationModeSelection, PendingRuntimeIntent, RequestedFastMode } from "./intent";

export interface RuntimeSnapshot {
  runtimeConfig: RuntimeConfigSnapshot | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ActiveCollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  requestedModel: PendingRuntimeIntent<string>;
  requestedReasoningEffort: PendingRuntimeIntent<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeIntent<ApprovalsReviewer>;
  selectedCollaborationMode: CollaborationModeSelection;
  requestedFastMode: PendingRuntimeIntent<RequestedFastMode>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly ModelMetadata[];
}
