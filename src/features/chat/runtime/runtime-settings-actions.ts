import type { AppServerClient } from "../../../app-server/client";
import { requestedServiceTierRequestValue, type RequestedServiceTier } from "../../../app-server/service-tier";
import type { ModeKind } from "../../../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../../generated/app-server/v2/ApprovalsReviewer";
import type { ThreadSettingsUpdateParams } from "../../../generated/app-server/v2/ThreadSettingsUpdateParams";
import { collaborationModeToggleMessage, nextCollaborationMode } from "../../../runtime/collaboration-mode";
import { readRuntimeConfig } from "../../../runtime/config";
import {
  autoReviewActive,
  fastModeActive,
  fastServiceTierRequestValue,
  pendingRuntimeSettingPayload,
  requestedTurnRuntimeSettings,
  type RuntimeSnapshot,
} from "../../../runtime/state";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../../runtime/settings";
import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";

type ThreadSettingsUpdate = Omit<ThreadSettingsUpdateParams, "threadId">;

export interface RuntimeSettingsActionsHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  addSystemMessage: (text: string) => void;
}

export interface ChatRuntimeSettingsActions {
  applyPendingThreadSettings: () => Promise<boolean>;
  setRequestedModel: (model: string | null) => Promise<boolean>;
  setRequestedModelFromUi: (model: string | null) => Promise<void>;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => Promise<boolean>;
  setRequestedReasoningEffortFromUi: (effort: ReasoningEffort | null) => Promise<void>;
  toggleFastMode: () => Promise<void>;
  toggleCollaborationMode: () => Promise<void>;
  setCollaborationMode: (collaborationMode: ModeKind) => Promise<boolean>;
  toggleAutoReview: () => Promise<void>;
}

export function createChatRuntimeSettingsActions(host: RuntimeSettingsActionsHost): ChatRuntimeSettingsActions {
  return {
    applyPendingThreadSettings: () => applyPendingThreadSettings(host),
    setRequestedModel: (model) => setRequestedModel(host, model),
    setRequestedModelFromUi: (model) => setRequestedModelFromUi(host, model),
    setRequestedReasoningEffort: (effort) => setRequestedReasoningEffort(host, effort),
    setRequestedReasoningEffortFromUi: (effort) => setRequestedReasoningEffortFromUi(host, effort),
    toggleFastMode: () => toggleFastMode(host),
    toggleCollaborationMode: () => toggleCollaborationMode(host),
    setCollaborationMode: (collaborationMode) => setCollaborationMode(host, collaborationMode),
    toggleAutoReview: () => toggleAutoReview(host),
  };
}

async function applyPendingThreadSettings(host: RuntimeSettingsActionsHost): Promise<boolean> {
  const client = host.currentClient();
  const threadId = state(host).activeThread.id;
  if (!client || !threadId) return true;

  const update = pendingThreadSettingsUpdate(host);
  if (Object.keys(update).length === 0) return true;

  try {
    await client.updateThreadSettings(threadId, update);
    dispatch(host, { type: "runtime/pending-thread-settings-committed", update });
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function setRequestedModel(host: RuntimeSettingsActionsHost, model: string | null): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-model-set", model });
  return applyPendingThreadSettings(host);
}

async function setRequestedModelFromUi(host: RuntimeSettingsActionsHost, model: string | null): Promise<void> {
  if (!(await setRequestedModel(host, model))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(modelOverrideMessage(model));
}

async function setRequestedReasoningEffort(host: RuntimeSettingsActionsHost, effort: ReasoningEffort | null): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-effort-set", effort });
  return applyPendingThreadSettings(host);
}

async function setRequestedReasoningEffortFromUi(host: RuntimeSettingsActionsHost, effort: ReasoningEffort | null): Promise<void> {
  if (!(await setRequestedReasoningEffort(host, effort))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(reasoningEffortOverrideMessage(effort));
}

async function toggleFastMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const snapshot = host.runtimeSnapshot();
  const config = readRuntimeConfig(state(host).connection.effectiveConfig);
  const next: RequestedServiceTier = fastModeActive(snapshot, config) ? "off" : "fast";
  dispatch(host, { type: "runtime/requested-service-tier-set", serviceTier: next });
  dispatch(host, { type: "ui/panel-set", panel: null });
  if (!(await applyPendingThreadSettings(host))) return;
  host.addSystemMessage(next === "fast" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.");
}

async function toggleCollaborationMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const next = nextCollaborationMode(state(host).runtime.selectedCollaborationMode);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsActionsHost, collaborationMode: ModeKind): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  dispatch(host, { type: "ui/panel-set", panel: null });
  const applied = await applyPendingThreadSettings(host);
  if (applied) host.addSystemMessage(collaborationModeToggleMessage(collaborationMode));
  return applied;
}

async function toggleAutoReview(host: RuntimeSettingsActionsHost): Promise<void> {
  const next: ApprovalsReviewer = autoReviewActive(host.runtimeSnapshot(), readRuntimeConfig(state(host).connection.effectiveConfig))
    ? "user"
    : "auto_review";
  dispatch(host, { type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: next });
  dispatch(host, { type: "ui/panel-set", panel: null });
  if (!(await applyPendingThreadSettings(host))) return;
  host.addSystemMessage(next === "auto_review" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.");
}

function pendingThreadSettingsUpdate(host: RuntimeSettingsActionsHost): ThreadSettingsUpdate {
  const update: ThreadSettingsUpdate = {};
  const currentState = state(host);
  const snapshot = host.runtimeSnapshot();
  const turnSettings = requestedTurnRuntimeSettings(snapshot);

  if (currentState.runtime.requestedModel.kind !== "unchanged") {
    const model = pendingRuntimeSettingPayload(currentState.runtime.requestedModel);
    if (model !== undefined) update.model = model;
  }
  if (currentState.runtime.requestedReasoningEffort.kind !== "unchanged") {
    const effort = pendingRuntimeSettingPayload(currentState.runtime.requestedReasoningEffort);
    if (effort !== undefined) update.effort = effort;
  }
  if (currentState.runtime.requestedServiceTier.kind === "set") {
    const serviceTier = requestedServiceTierRequestValue(
      currentState.runtime.requestedServiceTier.value,
      fastServiceTierRequestValue(snapshot, readRuntimeConfig(currentState.connection.effectiveConfig)),
    );
    if (serviceTier !== undefined) update.serviceTier = serviceTier;
  } else if (currentState.runtime.requestedServiceTier.kind === "resetToConfig") {
    update.serviceTier = null;
  }
  if (currentState.runtime.requestedApprovalsReviewer.kind !== "unchanged") {
    const approvalsReviewer = pendingRuntimeSettingPayload(currentState.runtime.requestedApprovalsReviewer);
    if (approvalsReviewer !== undefined) update.approvalsReviewer = approvalsReviewer;
  }
  if (currentState.runtime.selectedCollaborationMode !== currentState.runtime.activeCollaborationMode) {
    if (turnSettings.warning) {
      host.addSystemMessage(`${host.collaborationModeLabel()} mode is selected, but ${turnSettings.warning}`);
    } else if (turnSettings.collaborationMode) {
      update.collaborationMode = turnSettings.collaborationMode;
    }
  }
  return update;
}

function state(host: RuntimeSettingsActionsHost): ChatState {
  return host.stateStore.getState();
}

function dispatch(host: RuntimeSettingsActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}
