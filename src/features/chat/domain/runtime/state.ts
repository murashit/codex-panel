import { parseServiceTier, type ApprovalsReviewer, type ServiceTier } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import { normalizeReasoningEffort, type ReasoningEffort } from "../../../../domain/catalog/metadata";
import {
  resetRuntimeIntentToConfig,
  setRuntimeIntentValue,
  unchangedRuntimeIntent,
  type ActiveCollaborationMode,
  type CollaborationModeSelection,
  type PendingRuntimeIntent,
  type RequestedFastMode,
} from "./intent";

export interface ChatRuntimeState {
  readonly activeModel: string | null;
  readonly activeReasoningEffort: ReasoningEffort | null;
  readonly activeCollaborationMode: ActiveCollaborationMode;
  readonly activeServiceTier: ServiceTier | null;
  readonly activeApprovalsReviewer: ApprovalsReviewer | null;
  readonly requestedModel: PendingRuntimeIntent<string>;
  readonly requestedReasoningEffort: PendingRuntimeIntent<ReasoningEffort>;
  readonly requestedApprovalsReviewer: PendingRuntimeIntent<ApprovalsReviewer>;
  readonly selectedCollaborationMode: CollaborationModeSelection;
  readonly requestedFastMode: PendingRuntimeIntent<RequestedFastMode>;
}

export function initialActiveChatRuntimeState(): Pick<
  ChatRuntimeState,
  "activeModel" | "activeReasoningEffort" | "activeCollaborationMode" | "activeServiceTier" | "activeApprovalsReviewer"
> {
  return {
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: null,
    activeServiceTier: null,
    activeApprovalsReviewer: null,
  };
}

export function initialChatRuntimeState(): ChatRuntimeState {
  return {
    ...initialActiveChatRuntimeState(),
    requestedModel: unchangedRuntimeIntent(),
    requestedReasoningEffort: unchangedRuntimeIntent(),
    requestedApprovalsReviewer: unchangedRuntimeIntent(),
    selectedCollaborationMode: "default",
    requestedFastMode: unchangedRuntimeIntent(),
  };
}

export function requestModelRuntimeState(state: ChatRuntimeState, model: string): ChatRuntimeState {
  return {
    ...state,
    requestedModel: setRuntimeIntentValue(model),
  };
}

export function resetModelToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedModel: resetRuntimeIntentToConfig(),
  };
}

export function requestReasoningEffortRuntimeState(state: ChatRuntimeState, effort: ReasoningEffort): ChatRuntimeState {
  return {
    ...state,
    requestedReasoningEffort: setRuntimeIntentValue(effort),
  };
}

export function resetReasoningEffortToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedReasoningEffort: resetRuntimeIntentToConfig(),
  };
}

export function requestFastModeRuntimeState(state: ChatRuntimeState, fastMode: RequestedFastMode): ChatRuntimeState {
  return {
    ...state,
    requestedFastMode: setRuntimeIntentValue(fastMode),
  };
}

export function clearRequestedFastModeRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedFastMode: unchangedRuntimeIntent(),
  };
}

export function requestApprovalsReviewerRuntimeState(state: ChatRuntimeState, approvalsReviewer: ApprovalsReviewer): ChatRuntimeState {
  return {
    ...state,
    requestedApprovalsReviewer: setRuntimeIntentValue(approvalsReviewer),
  };
}

export function clearRequestedApprovalsReviewerRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedApprovalsReviewer: unchangedRuntimeIntent(),
  };
}

export function setSelectedCollaborationModeRuntimeState(
  state: ChatRuntimeState,
  collaborationMode: CollaborationModeSelection,
): ChatRuntimeState {
  return {
    ...state,
    selectedCollaborationMode: collaborationMode,
  };
}

export function commitAppliedRuntimeSettingsPatchState(state: ChatRuntimeState, update: RuntimeSettingsPatch): ChatRuntimeState {
  return {
    ...state,
    ...("model" in update ? { activeModel: update.model ?? null, requestedModel: unchangedRuntimeIntent<string>() } : {}),
    ...("effort" in update
      ? {
          activeReasoningEffort: normalizeReasoningEffort(update.effort),
          requestedReasoningEffort: unchangedRuntimeIntent<ReasoningEffort>(),
        }
      : {}),
    ...("serviceTier" in update
      ? { activeServiceTier: parseServiceTier(update.serviceTier), requestedFastMode: unchangedRuntimeIntent<RequestedFastMode>() }
      : {}),
    ...("approvalsReviewer" in update
      ? {
          activeApprovalsReviewer: update.approvalsReviewer ?? null,
          requestedApprovalsReviewer: unchangedRuntimeIntent<ApprovalsReviewer>(),
        }
      : {}),
    ...(update.collaborationMode ? { activeCollaborationMode: update.collaborationMode.mode } : {}),
  };
}
