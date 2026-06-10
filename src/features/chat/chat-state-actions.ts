import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { Thread } from "../../domain/threads/model";
import type { ThreadTokenUsage } from "../../app-server/runtime-metrics";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { ChatRuntimeState } from "./runtime/state";
import type { CollaborationMode } from "./runtime/collaboration";
import { parseServiceTier, type ServiceTier } from "../../app-server/thread-settings";
import type { DisplayItem } from "./display/types";
import type { PendingTurnStart } from "./turns/turn-state";

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
  displayItems?: readonly DisplayItem[];
  status?: string;
  listedThreads?: readonly Thread[];
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
  effort: ReasoningEffort | null;
  collaborationMode: { mode: CollaborationMode };
  serviceTier: string | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
}

export interface ConnectionInitializedAction {
  type: "connection/initialized";
  initializeResponse: InitializeResponse;
}

export interface ClearDisconnectedConnectionStateAction {
  type: "connection/scoped-cleared";
}

export interface ClearLocalTurnAction {
  type: "turn/scoped-cleared";
}

export interface SetRequestedCollaborationModeDefaultAction {
  type: "runtime/requested-collaboration-mode-set";
  collaborationMode: "default";
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
  item: DisplayItem;
}

export interface ActiveThreadTokenUsageSetAction {
  type: "active-thread/token-usage-set";
  tokenUsage: ThreadTokenUsage;
}

export interface ClosePanelsAction {
  type: "ui/panel-set";
  panel: null;
  toggle?: boolean;
}

export interface DetailOpenSetAction {
  type: "ui/detail-open-set";
  key: string;
  open: boolean;
}

export interface UserInputDraftSetAction {
  type: "request/user-input-draft-set";
  key: string;
  value: string;
}

export interface TurnOptimisticStartedAction {
  type: "turn/optimistic-started";
  item: DisplayItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAcknowledgedAction {
  type: "turn/start-acknowledged";
  turnId: string;
  displayItems: readonly DisplayItem[];
}

export interface TurnStartFailedAction {
  type: "turn/start-failed";
  displayItems: readonly DisplayItem[];
}

export interface TranscriptItemAddedAction {
  type: "transcript/item-added";
  item: DisplayItem;
}

export function connectionInitializedAction(initializeResponse: InitializeResponse): ConnectionInitializedAction {
  return { type: "connection/initialized", initializeResponse };
}

export function clearDisconnectedConnectionStateAction(): ClearDisconnectedConnectionStateAction {
  return { type: "connection/scoped-cleared" };
}

export function clearLocalTurnAction(): ClearLocalTurnAction {
  return { type: "turn/scoped-cleared" };
}

export function setRequestedCollaborationModeDefaultAction(): SetRequestedCollaborationModeDefaultAction {
  return { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" };
}

export function clearActiveThreadAction(): ClearActiveThreadAction {
  return { type: "active-thread/cleared" };
}

export function applyThreadListAction(threads: readonly Thread[], threadsLoaded?: boolean): ThreadListAppliedAction {
  return { type: "thread-list/applied", threads, ...(threadsLoaded === undefined ? {} : { threadsLoaded }) };
}

export function restoreThreadPlaceholderAction(threadId: string, item: DisplayItem): ActiveThreadRestoredPlaceholderAction {
  return { type: "active-thread/restored-placeholder", threadId, item };
}

export function setActiveThreadTokenUsageAction(tokenUsage: ThreadTokenUsage): ActiveThreadTokenUsageSetAction {
  return { type: "active-thread/token-usage-set", tokenUsage };
}

export function activeThreadSettingsAppliedAction(settings: ActiveThreadSettingsAppliedActionSettings): ActiveThreadSettingsAppliedAction {
  return {
    type: "active-thread/settings-applied",
    cwd: settings.cwd,
    model: settings.model,
    reasoningEffort: settings.effort,
    collaborationMode: settings.collaborationMode.mode,
    serviceTier: parseServiceTier(settings.serviceTier),
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
    activePermissionProfile: settings.activePermissionProfile,
  };
}

export function closePanelsAction(): ClosePanelsAction {
  return { type: "ui/panel-set", panel: null };
}

export function setDetailOpenAction(key: string, open: boolean): DetailOpenSetAction {
  return { type: "ui/detail-open-set", key, open };
}

export function setUserInputDraftAction(key: string, value: string): UserInputDraftSetAction {
  return { type: "request/user-input-draft-set", key, value };
}

export function optimisticTurnStartedAction(item: DisplayItem, pendingTurnStart: PendingTurnStart): TurnOptimisticStartedAction {
  return { type: "turn/optimistic-started", item, pendingTurnStart };
}

export function turnStartAcknowledgedAction(turnId: string, displayItems: readonly DisplayItem[]): TurnStartAcknowledgedAction {
  return { type: "turn/start-acknowledged", turnId, displayItems };
}

export function turnStartFailedAction(displayItems: readonly DisplayItem[]): TurnStartFailedAction {
  return { type: "turn/start-failed", displayItems };
}

export function addTranscriptItemAction(item: DisplayItem): TranscriptItemAddedAction {
  return { type: "transcript/item-added", item };
}
