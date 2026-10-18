import type { ReasoningEffort } from "../../../../domain/runtime/catalog";
import {
  initialRuntimePermissionKnownState,
  initialRuntimePermissionState,
  type RuntimePermissionKnownState,
  type RuntimePermissionState,
} from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/settings";
import {
  type ActiveCollaborationMode,
  type CollaborationModeIntent,
  type FastModeIntent,
  type PendingRuntimeIntent,
  unchangedCollaborationModeIntent,
  unchangedRuntimeIntent,
} from "./intent";

export interface ChatRuntimeState {
  readonly active: ActiveThreadRuntimeState;
  readonly pending: PendingRuntimeIntentState;
}

export interface ActiveThreadRuntimeState extends RuntimePermissionState, RuntimePermissionKnownState {
  readonly serviceTierKnown: boolean;
  readonly model: string | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly collaborationMode: ActiveCollaborationMode;
  readonly serviceTier: ServiceTier | null;
  readonly approvalsReviewer: ApprovalsReviewer | null;
}

export interface PendingRuntimeIntentState {
  readonly model: PendingRuntimeIntent<string>;
  readonly reasoningEffort: PendingRuntimeIntent<ReasoningEffort | null>;
  readonly permissionProfile: PendingRuntimeIntent<string>;
  readonly approvalsReviewer: PendingRuntimeIntent<ApprovalsReviewer>;
  readonly collaborationMode: CollaborationModeIntent;
  readonly fastMode: FastModeIntent;
}

function initialActiveChatRuntimeState(): ActiveThreadRuntimeState {
  return {
    ...initialRuntimePermissionState(),
    ...initialRuntimePermissionKnownState(),
    serviceTierKnown: false,
    model: null,
    reasoningEffort: null,
    collaborationMode: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

function initialPendingRuntimeIntentState(): PendingRuntimeIntentState {
  return {
    model: unchangedRuntimeIntent(),
    reasoningEffort: unchangedRuntimeIntent(),
    permissionProfile: unchangedRuntimeIntent(),
    approvalsReviewer: unchangedRuntimeIntent(),
    collaborationMode: unchangedCollaborationModeIntent(),
    fastMode: unchangedRuntimeIntent(),
  };
}

export function initialChatRuntimeState(): ChatRuntimeState {
  return {
    active: initialActiveChatRuntimeState(),
    pending: initialPendingRuntimeIntentState(),
  };
}

export function confirmRuntimeIntentState(state: ChatRuntimeState, intents: Partial<PendingRuntimeIntentState>): ChatRuntimeState {
  const pending = { ...state.pending };
  for (const key of Object.keys(intents) as (keyof PendingRuntimeIntentState)[]) {
    // Keep requests made while the confirmed update was in flight.
    if (pending[key] === intents[key]) pending[key] = unchangedRuntimeIntent();
  }
  return { ...state, pending };
}
