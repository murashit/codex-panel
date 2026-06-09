import type { ActivePermissionProfile } from "../../../generated/app-server/v2/ActivePermissionProfile";
import type { AskForApproval } from "../../../generated/app-server/v2/AskForApproval";
import { parseServiceTier, type ServiceTier, type ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import type { PanelCollaborationMode } from "./collaboration";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { ApprovalsReviewer } from "./approvals";
import type { RequestedServiceTier } from "./service-tier-state";
import {
  resetRuntimeSettingToConfig,
  setPendingRuntimeSetting,
  unchangedRuntimeSetting,
  type PendingRuntimeSetting,
} from "./effective-settings";

export interface ChatRuntimeState {
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: PanelCollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: AskForApproval | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: PanelCollaborationMode;
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

export function setRequestedModelRuntimeState(state: ChatRuntimeState, model: string | null): ChatRuntimeState {
  return {
    ...state,
    requestedModel: model === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(model),
  };
}

export function setRequestedReasoningEffortRuntimeState(state: ChatRuntimeState, effort: ReasoningEffort | null): ChatRuntimeState {
  return {
    ...state,
    requestedReasoningEffort: effort === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(effort),
  };
}

export function setRequestedServiceTierRuntimeState(state: ChatRuntimeState, serviceTier: RequestedServiceTier | null): ChatRuntimeState {
  return {
    ...state,
    requestedServiceTier: serviceTier === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(serviceTier),
  };
}

export function setRequestedApprovalsReviewerRuntimeState(
  state: ChatRuntimeState,
  approvalsReviewer: ApprovalsReviewer | null,
): ChatRuntimeState {
  return {
    ...state,
    requestedApprovalsReviewer: approvalsReviewer === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(approvalsReviewer),
  };
}

export function setSelectedCollaborationModeRuntimeState(
  state: ChatRuntimeState,
  collaborationMode: PanelCollaborationMode,
): ChatRuntimeState {
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
      ? { activeReasoningEffort: update.effort ?? null, requestedReasoningEffort: unchangedRuntimeSetting<ReasoningEffort>() }
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
