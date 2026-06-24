import { normalizeReasoningEffort, type ReasoningEffort } from "../../../../domain/catalog/metadata";
import { type ApprovalsReviewer, parseServiceTier, type ServiceTier } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import {
  type ActiveCollaborationMode,
  type CollaborationModeSelection,
  type PendingRuntimeIntent,
  type RequestedFastMode,
  resetRuntimeIntentToConfig,
  setRuntimeIntentValue,
  unchangedRuntimeIntent,
} from "./intent";

export interface ChatRuntimeState {
  readonly active: ActiveThreadRuntimeState;
  readonly pending: PendingRuntimeIntentState;
}

export interface ActiveThreadRuntimeState {
  readonly serviceTierKnown: boolean;
  readonly model: string | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly collaborationMode: ActiveCollaborationMode;
  readonly serviceTier: ServiceTier | null;
  readonly approvalsReviewer: ApprovalsReviewer | null;
}

export interface PendingRuntimeIntentState {
  readonly model: PendingRuntimeIntent<string>;
  readonly reasoningEffort: PendingRuntimeIntent<ReasoningEffort>;
  readonly approvalsReviewer: PendingRuntimeIntent<ApprovalsReviewer>;
  readonly collaborationMode: CollaborationModeSelection;
  readonly fastMode: PendingRuntimeIntent<RequestedFastMode>;
}

export function initialActiveChatRuntimeState(): ActiveThreadRuntimeState {
  return {
    serviceTierKnown: false,
    model: null,
    reasoningEffort: null,
    collaborationMode: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

export function activeThreadRuntimeState(state: ChatRuntimeState): ActiveThreadRuntimeState {
  return state.active;
}

export function pendingRuntimeIntentState(state: ChatRuntimeState): PendingRuntimeIntentState {
  return state.pending;
}

function initialPendingRuntimeIntentState(): PendingRuntimeIntentState {
  return {
    model: unchangedRuntimeIntent(),
    reasoningEffort: unchangedRuntimeIntent(),
    approvalsReviewer: unchangedRuntimeIntent(),
    collaborationMode: "default",
    fastMode: unchangedRuntimeIntent(),
  };
}

export function initialChatRuntimeState(): ChatRuntimeState {
  return {
    active: initialActiveChatRuntimeState(),
    pending: initialPendingRuntimeIntentState(),
  };
}

export function requestModelRuntimeState(state: ChatRuntimeState, model: string): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, model: setRuntimeIntentValue(model) },
  };
}

export function resetModelToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, model: resetRuntimeIntentToConfig() },
  };
}

export function requestReasoningEffortRuntimeState(state: ChatRuntimeState, effort: ReasoningEffort): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, reasoningEffort: setRuntimeIntentValue(effort) },
  };
}

export function resetReasoningEffortToConfigRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, reasoningEffort: resetRuntimeIntentToConfig() },
  };
}

export function requestFastModeRuntimeState(state: ChatRuntimeState, fastMode: RequestedFastMode): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, fastMode: setRuntimeIntentValue(fastMode) },
  };
}

export function clearRequestedFastModeRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, fastMode: unchangedRuntimeIntent() },
  };
}

export function requestApprovalsReviewerRuntimeState(state: ChatRuntimeState, approvalsReviewer: ApprovalsReviewer): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, approvalsReviewer: setRuntimeIntentValue(approvalsReviewer) },
  };
}

export function clearRequestedApprovalsReviewerRuntimeState(state: ChatRuntimeState): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, approvalsReviewer: unchangedRuntimeIntent() },
  };
}

export function setSelectedCollaborationModeRuntimeState(
  state: ChatRuntimeState,
  collaborationMode: CollaborationModeSelection,
): ChatRuntimeState {
  return {
    ...state,
    pending: { ...state.pending, collaborationMode },
  };
}

export function commitAppliedRuntimeSettingsPatchState(state: ChatRuntimeState, update: RuntimeSettingsPatch): ChatRuntimeState {
  return {
    ...state,
    active: {
      ...state.active,
      ...("model" in update ? { model: update.model ?? null } : {}),
      ...("effort" in update ? { reasoningEffort: normalizeReasoningEffort(update.effort) } : {}),
      ...("serviceTier" in update ? { serviceTier: parseServiceTier(update.serviceTier), serviceTierKnown: true } : {}),
      ...("approvalsReviewer" in update ? { approvalsReviewer: update.approvalsReviewer ?? null } : {}),
      ...(update.collaborationMode ? { collaborationMode: update.collaborationMode.mode } : {}),
    },
    pending: {
      ...state.pending,
      ...("model" in update ? { model: unchangedRuntimeIntent<string>() } : {}),
      ...("effort" in update ? { reasoningEffort: unchangedRuntimeIntent<ReasoningEffort>() } : {}),
      ...("serviceTier" in update ? { fastMode: unchangedRuntimeIntent<RequestedFastMode>() } : {}),
      ...("approvalsReviewer" in update ? { approvalsReviewer: unchangedRuntimeIntent<ApprovalsReviewer>() } : {}),
    },
  };
}
