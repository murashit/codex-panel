import { normalizeReasoningEffort, type ReasoningEffort } from "../../../../domain/catalog/metadata";
import {
  type RuntimePermissionKnownState,
  type RuntimePermissionState,
  runtimePermissionStateOrDefault,
} from "../../../../domain/runtime/permissions";
import { parseServiceTier, type ServiceTier } from "../../../../domain/runtime/policy";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import { type Thread, upsertThread } from "../../../../domain/threads/model";
import type { CollaborationModeSelection } from "../../domain/runtime/intent";
import type { ActiveThreadRuntimeState } from "../../domain/runtime/state";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { PendingTurnStart } from "../turns/turn-state";

interface ResumedThreadActionParams {
  response: ThreadActivationSnapshot;
  listedThreads?: readonly Thread[];
  items?: readonly ThreadStreamItem[];
  preserveRequestedRuntimeSettings?: boolean;
  serviceTierKnown?: boolean;
}

interface ResumedThreadFromActiveRuntimeParams {
  thread: Thread;
  cwd: string;
  runtime: Pick<
    ActiveThreadRuntimeState,
    | "model"
    | "reasoningEffort"
    | "serviceTier"
    | "serviceTierKnown"
    | "approvalsReviewer"
    | "approvalPolicyKnown"
    | "sandboxPolicyKnown"
    | "permissionProfileKnown"
    | "approvalPolicy"
    | "sandboxPolicy"
    | "activePermissionProfile"
  >;
  listedThreads?: readonly Thread[];
  items?: readonly ThreadStreamItem[];
}

export interface ActiveThreadResumedAction extends RuntimePermissionState, RuntimePermissionKnownState {
  type: "active-thread/resumed";
  thread: Thread;
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  serviceTierKnown?: boolean;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
  items?: readonly ThreadStreamItem[];
  status?: string;
  listedThreads?: readonly Thread[];
  preserveRequestedRuntimeSettings?: boolean;
}

export interface ActiveThreadSettingsAppliedAction extends RuntimePermissionState, RuntimePermissionKnownState {
  type: "active-thread/settings-applied";
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  collaborationMode: CollaborationModeSelection;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
}

export interface ActiveThreadSettingsAppliedActionSettings extends RuntimePermissionState {
  cwd: string;
  model: string | null;
  effort: string | null;
  collaborationMode: { mode: CollaborationModeSelection };
  serviceTier: string | null;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
}

export interface ConnectionInitializedAction {
  type: "connection/initialized";
  initializeResponse: ServerInitialization;
}

export interface ClearDisconnectedConnectionStateAction {
  type: "connection/scoped-cleared";
}

export interface ClearLocalTurnAction {
  type: "turn/scoped-cleared";
}

export interface ClearActiveThreadAction {
  type: "active-thread/cleared";
}

export interface ThreadListAppliedAction {
  type: "thread-list/applied";
  threads: readonly Thread[];
  threadsLoaded?: boolean;
}

export interface DisclosureSetAction {
  type: "ui/disclosure-set";
  bucket: "details" | "activityGroups" | "textDetails" | "userMessageExpanded" | "goalObjectiveExpanded" | "approvalDetails";
  id: string;
  open: boolean;
}

export interface TurnOptimisticStartedAction {
  type: "turn/optimistic-started";
  item: ThreadStreamItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAcknowledgedAction {
  type: "turn/start-acknowledged";
  turnId: string;
  items: readonly ThreadStreamItem[];
}

export interface TurnStartFailedAction {
  type: "turn/start-failed";
  items: readonly ThreadStreamItem[];
}

export function resumedThreadActionFromActiveRuntime(params: ResumedThreadFromActiveRuntimeParams): ActiveThreadResumedAction {
  return resumedThreadAction({
    response: {
      thread: params.thread,
      cwd: params.cwd,
      approvalPolicyKnown: params.runtime.approvalPolicyKnown,
      sandboxPolicyKnown: params.runtime.sandboxPolicyKnown,
      permissionProfileKnown: params.runtime.permissionProfileKnown,
      model: params.runtime.model,
      reasoningEffort: params.runtime.reasoningEffort,
      serviceTier: params.runtime.serviceTier,
      approvalsReviewer: params.runtime.approvalsReviewer,
      approvalPolicy: params.runtime.approvalPolicy,
      sandboxPolicy: params.runtime.sandboxPolicy,
      activePermissionProfile: params.runtime.activePermissionProfile,
    },
    serviceTierKnown: params.runtime.serviceTierKnown,
    ...(params.listedThreads ? { listedThreads: params.listedThreads } : {}),
    ...(params.items ? { items: params.items } : {}),
  });
}

export function resumedThreadAction(params: ResumedThreadActionParams): ActiveThreadResumedAction {
  const { response } = params;
  const permissions = runtimePermissionStateOrDefault(response);
  return {
    type: "active-thread/resumed",
    thread: response.thread,
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: response.serviceTier,
    serviceTierKnown: params.serviceTierKnown ?? true,
    approvalsReviewer: response.approvalsReviewer,
    approvalPolicyKnown: response.approvalPolicyKnown,
    sandboxPolicyKnown: response.sandboxPolicyKnown,
    permissionProfileKnown: response.permissionProfileKnown,
    ...permissions,
    ...(params.items ? { items: params.items } : {}),
    ...(params.listedThreads ? { listedThreads: upsertThread(params.listedThreads, response.thread) } : {}),
    ...(params.preserveRequestedRuntimeSettings ? { preserveRequestedRuntimeSettings: true } : {}),
  };
}

export function activeThreadSettingsAppliedAction(settings: ActiveThreadSettingsAppliedActionSettings): ActiveThreadSettingsAppliedAction {
  const permissions = runtimePermissionStateOrDefault(settings);
  return {
    type: "active-thread/settings-applied",
    cwd: settings.cwd,
    model: settings.model,
    reasoningEffort: normalizeReasoningEffort(settings.effort),
    collaborationMode: settings.collaborationMode.mode,
    serviceTier: parseServiceTier(settings.serviceTier),
    approvalsReviewer: settings.approvalsReviewer,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    ...permissions,
  };
}
