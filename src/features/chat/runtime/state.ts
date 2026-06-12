import {
  parseServiceTier,
  type ActivePermissionProfile,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type ServiceTier,
} from "../../../app-server/runtime-policy";
import type { ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import { normalizeReasoningEffort, type ReasoningEffort } from "../../../domain/catalog/metadata";
import {
  resetRuntimeSettingToConfig,
  setPendingRuntimeSetting,
  unchangedRuntimeSetting,
  type CollaborationMode,
  type PendingRuntimeSetting,
  type RequestedServiceTier,
} from "./settings";

export interface ChatRuntimeState {
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: CollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: ApprovalPolicy | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: CollaborationMode;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
}

export function initialActiveChatRuntimeState(): Pick<
  ChatRuntimeState,
  | "activeModel"
  | "activeReasoningEffort"
  | "activeCollaborationMode"
  | "activeServiceTier"
  | "activeApprovalPolicy"
  | "activeApprovalsReviewer"
  | "activePermissionProfile"
> {
  return {
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalPolicy: null,
    activeApprovalsReviewer: null,
    activePermissionProfile: null,
  };
}

export function initialChatRuntimeState(): ChatRuntimeState {
  return {
    ...initialActiveChatRuntimeState(),
    requestedModel: unchangedRuntimeSetting(),
    requestedReasoningEffort: unchangedRuntimeSetting(),
    requestedApprovalsReviewer: unchangedRuntimeSetting(),
    selectedCollaborationMode: "default",
    requestedServiceTier: unchangedRuntimeSetting(),
  };
}

export function requestModelRuntimeState(state: ChatRuntimeState, model: string): ChatRuntimeState {
  return {
    ...state,
    requestedModel: setPendingRuntimeSetting(model),
  };
}

export function resetModelToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedModel: resetRuntimeSettingToConfig(),
  };
}

export function requestReasoningEffortRuntimeState(state: ChatRuntimeState, effort: ReasoningEffort): ChatRuntimeState {
  return {
    ...state,
    requestedReasoningEffort: setPendingRuntimeSetting(effort),
  };
}

export function resetReasoningEffortToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedReasoningEffort: resetRuntimeSettingToConfig(),
  };
}

export function requestServiceTierRuntimeState(state: ChatRuntimeState, serviceTier: RequestedServiceTier): ChatRuntimeState {
  return {
    ...state,
    requestedServiceTier: setPendingRuntimeSetting(serviceTier),
  };
}

export function clearRequestedServiceTierRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedServiceTier: unchangedRuntimeSetting(),
  };
}

export function requestApprovalsReviewerRuntimeState(state: ChatRuntimeState, approvalsReviewer: ApprovalsReviewer): ChatRuntimeState {
  return {
    ...state,
    requestedApprovalsReviewer: setPendingRuntimeSetting(approvalsReviewer),
  };
}

export function clearRequestedApprovalsReviewerRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    requestedApprovalsReviewer: unchangedRuntimeSetting(),
  };
}

export function setSelectedCollaborationModeRuntimeState(state: ChatRuntimeState, collaborationMode: CollaborationMode): ChatRuntimeState {
  return {
    ...state,
    selectedCollaborationMode: collaborationMode,
  };
}

export function commitPendingThreadSettingsRuntimeState(state: ChatRuntimeState, update: ThreadSettingsUpdate): ChatRuntimeState {
  return {
    ...state,
    ...("model" in update ? { activeModel: update.model ?? null, requestedModel: unchangedRuntimeSetting<string>() } : {}),
    ...("effort" in update
      ? {
          activeReasoningEffort: normalizeReasoningEffort(update.effort),
          requestedReasoningEffort: unchangedRuntimeSetting<ReasoningEffort>(),
        }
      : {}),
    ...("serviceTier" in update
      ? { activeServiceTier: parseServiceTier(update.serviceTier), requestedServiceTier: unchangedRuntimeSetting<RequestedServiceTier>() }
      : {}),
    ...("approvalsReviewer" in update
      ? {
          activeApprovalsReviewer: update.approvalsReviewer ?? null,
          requestedApprovalsReviewer: unchangedRuntimeSetting<ApprovalsReviewer>(),
        }
      : {}),
    ...(update.collaborationMode ? { activeCollaborationMode: update.collaborationMode.mode } : {}),
  };
}
