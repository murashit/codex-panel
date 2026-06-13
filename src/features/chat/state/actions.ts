import type { ServerInitialization } from "../../../domain/server/initialization";
import type { Thread } from "../../../domain/threads/model";
import { parseServiceTier, type ServiceTier } from "../../../domain/runtime/policy";
import { normalizeReasoningEffort, type ReasoningEffort } from "../../../domain/catalog/metadata";
import type { ChatRuntimeState } from "../runtime/state";
import type { CollaborationMode } from "../runtime/pending-settings";
import type { MessageStreamItem } from "../message-stream/items";
import type { PendingTurnStart } from "../conversation/turns/turn-state";

export interface ActiveThreadResumedAction {
  type: "active-thread/resumed";
  thread: Thread;
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
  items?: readonly MessageStreamItem[];
  status?: string;
  listedThreads?: readonly Thread[];
  preserveRequestedRuntimeSettings?: boolean;
}

export interface ActiveThreadSettingsAppliedAction {
  type: "active-thread/settings-applied";
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  collaborationMode: CollaborationMode;
  serviceTier: ServiceTier | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
}

export interface ActiveThreadSettingsAppliedActionSettings {
  cwd: string;
  model: string | null;
  effort: string | null;
  collaborationMode: { mode: CollaborationMode };
  serviceTier: string | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
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

export interface ActiveThreadRestoredPlaceholderAction {
  type: "active-thread/restored-placeholder";
  threadId: string;
}

export interface DisclosureSetAction {
  type: "ui/disclosure-set";
  bucket:
    | "toolResults"
    | "activityGroups"
    | "agentDetails"
    | "textDetails"
    | "userMessageExpanded"
    | "goalObjectiveExpanded"
    | "approvalDetails";
  id: string;
  open: boolean;
}

export interface UserInputDraftSetAction {
  type: "request/user-input-draft-set";
  key: string;
  value: string;
}

export interface TurnOptimisticStartedAction {
  type: "turn/optimistic-started";
  item: MessageStreamItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAcknowledgedAction {
  type: "turn/start-acknowledged";
  turnId: string;
  items: readonly MessageStreamItem[];
}

export interface TurnStartFailedAction {
  type: "turn/start-failed";
  items: readonly MessageStreamItem[];
}

export interface MessageStreamItemAddedAction {
  type: "message-stream/item-added";
  item: MessageStreamItem;
}

export function activeThreadSettingsAppliedAction(settings: ActiveThreadSettingsAppliedActionSettings): ActiveThreadSettingsAppliedAction {
  return {
    type: "active-thread/settings-applied",
    cwd: settings.cwd,
    model: settings.model,
    reasoningEffort: normalizeReasoningEffort(settings.effort),
    collaborationMode: settings.collaborationMode.mode,
    serviceTier: parseServiceTier(settings.serviceTier),
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
    activePermissionProfile: settings.activePermissionProfile,
  };
}
