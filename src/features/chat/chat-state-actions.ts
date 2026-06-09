import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { PanelThread } from "../../domain/threads/model";
import type { ThreadTokenUsage } from "../../generated/app-server/v2/ThreadTokenUsage";
import type { ReasoningEffort } from "../../domain/catalog/reasoning-effort";
import type { ChatRuntimeState } from "./runtime/state";
import type { PanelCollaborationMode } from "./runtime/collaboration";
import { parseServiceTier, type ServiceTier } from "../../app-server/service-tier";
import type { ChatAction, PendingTurnStart } from "./chat-state";
import type { DisplayItem } from "./display/types";

export interface ActiveThreadResumedAction {
  type: "active-thread/resumed";
  thread: PanelThread;
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
  displayItems?: readonly DisplayItem[];
  status?: string;
  listedThreads?: readonly PanelThread[];
}

export interface ActiveThreadSettingsAppliedAction {
  type: "active-thread/settings-applied";
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  collaborationMode: PanelCollaborationMode;
  serviceTier: ServiceTier | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
}

export interface ActiveThreadSettingsAppliedActionSettings {
  cwd: string;
  model: string | null;
  effort: ReasoningEffort | null;
  collaborationMode: { mode: PanelCollaborationMode };
  serviceTier: string | null;
  approvalPolicy: ChatRuntimeState["activeApprovalPolicy"];
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
}

export function connectionInitializedAction(initializeResponse: InitializeResponse): ChatAction {
  return { type: "connection/initialized", initializeResponse };
}

export function clearConnectionScopeAction(): ChatAction {
  return { type: "connection/scoped-cleared" };
}

export function clearLocalTurnAction(): ChatAction {
  return { type: "turn/scoped-cleared" };
}

export function setRequestedCollaborationModeDefaultAction(): ChatAction {
  return { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" };
}

export function clearActiveThreadAction(): ChatAction {
  return { type: "active-thread/cleared" };
}

export function applyThreadListAction(threads: readonly PanelThread[], threadsLoaded?: boolean): ChatAction {
  return { type: "thread-list/applied", threads, ...(threadsLoaded === undefined ? {} : { threadsLoaded }) };
}

export function restoreThreadPlaceholderAction(threadId: string, item: DisplayItem): ChatAction {
  return { type: "active-thread/restored-placeholder", threadId, item };
}

export function setActiveThreadTokenUsageAction(tokenUsage: ThreadTokenUsage): ChatAction {
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

export function closePanelsAction(): ChatAction {
  return { type: "ui/panel-set", panel: null };
}

export function setDetailOpenAction(key: string, open: boolean): ChatAction {
  return { type: "ui/detail-open-set", key, open };
}

export function setUserInputDraftAction(key: string, value: string): ChatAction {
  return { type: "request/user-input-draft-set", key, value };
}

export function optimisticTurnStartedAction(item: DisplayItem, pendingTurnStart: PendingTurnStart): ChatAction {
  return { type: "turn/optimistic-started", item, pendingTurnStart };
}

export function turnStartAcknowledgedAction(turnId: string, displayItems: readonly DisplayItem[]): ChatAction {
  return { type: "turn/start-acknowledged", turnId, displayItems };
}

export function turnStartFailedAction(displayItems: readonly DisplayItem[]): ChatAction {
  return { type: "turn/start-failed", displayItems };
}

export function addTranscriptItemAction(item: DisplayItem): ChatAction {
  return { type: "transcript/item-added", item };
}
