import type { AppServerClient } from "../../../app-server/client";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import { autoReviewReviewerForState, autoReviewToggleMessage, nextAutoReviewState } from "./approvals";
import type { PanelCollaborationMode } from "./collaboration";
import { collaborationModeToggleMessage, nextCollaborationMode } from "./collaboration";
import { readRuntimeConfig } from "./config";
import { autoReviewActive, fastModeActive, type RuntimeSnapshot } from "./effective-settings";
import {
  pendingThreadSettingsUpdate as buildPendingThreadSettingsUpdate,
  type ThreadSettingsUpdate,
  type TurnCollaborationModeWarning,
} from "./turn-settings";
import type { RequestedServiceTier } from "./service-tier-state";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "./override-commands";
import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";

const COLLABORATION_MODE_WARNING_MESSAGES: Record<TurnCollaborationModeWarning, string> = {
  "missing-model": "No effective model is available. Sending without a mode override.",
};

interface ApplyPendingThreadSettingsResult {
  ok: boolean;
  collaborationModeApplied: boolean;
}

interface PendingThreadSettingsUpdateResult {
  update: ThreadSettingsUpdate;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

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
  setCollaborationMode: (collaborationMode: PanelCollaborationMode) => Promise<boolean>;
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
  return (await applyPendingThreadSettingsResult(host)).ok;
}

async function applyPendingThreadSettingsResult(host: RuntimeSettingsActionsHost): Promise<ApplyPendingThreadSettingsResult> {
  const client = host.currentClient();
  const threadId = state(host).activeThread.id;
  if (!client || !threadId) return { ok: true, collaborationModeApplied: true };

  const { update, collaborationModeWarning } = pendingThreadSettingsUpdate(host);
  const collaborationModeApplied = !collaborationModeWarning && "collaborationMode" in update;
  if (Object.keys(update).length === 0) return { ok: true, collaborationModeApplied };

  try {
    await client.updateThreadSettings(threadId, update);
    dispatch(host, { type: "runtime/pending-thread-settings-committed", update });
    return { ok: true, collaborationModeApplied };
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return { ok: false, collaborationModeApplied: false };
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

async function setCollaborationMode(host: RuntimeSettingsActionsHost, collaborationMode: PanelCollaborationMode): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  dispatch(host, { type: "ui/panel-set", panel: null });
  const result = await applyPendingThreadSettingsResult(host);
  if (result.ok && result.collaborationModeApplied) host.addSystemMessage(collaborationModeToggleMessage(collaborationMode));
  return result.ok;
}

async function toggleAutoReview(host: RuntimeSettingsActionsHost): Promise<void> {
  const nextState = nextAutoReviewState(
    autoReviewActive(host.runtimeSnapshot(), readRuntimeConfig(state(host).connection.effectiveConfig)),
  );
  dispatch(host, { type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: autoReviewReviewerForState(nextState) });
  dispatch(host, { type: "ui/panel-set", panel: null });
  if (!(await applyPendingThreadSettings(host))) return;
  host.addSystemMessage(autoReviewToggleMessage(nextState));
}

function pendingThreadSettingsUpdate(host: RuntimeSettingsActionsHost): PendingThreadSettingsUpdateResult {
  const snapshot = host.runtimeSnapshot();
  const { update, collaborationModeWarning } = buildPendingThreadSettingsUpdate(snapshot);
  if (collaborationModeWarning) {
    host.addSystemMessage(
      `${host.collaborationModeLabel()} mode is selected, but ${collaborationModeWarningMessage(collaborationModeWarning)}`,
    );
  }
  return { update, collaborationModeWarning };
}

function collaborationModeWarningMessage(warning: TurnCollaborationModeWarning): string {
  return COLLABORATION_MODE_WARNING_MESSAGES[warning];
}

function state(host: RuntimeSettingsActionsHost): ChatState {
  return host.stateStore.getState();
}

function dispatch(host: RuntimeSettingsActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}
