import type { AppServerClient } from "../../../app-server/client";
import type { ApprovalsReviewer } from "../../../app-server/runtime-policy";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import { autoReviewActive, fastModeActive, runtimeConfigOrDefault, type RuntimeSnapshot } from "./effective-settings";
import {
  collaborationModeToggleMessage,
  nextCollaborationMode,
  pendingThreadSettingsUpdate as buildPendingThreadSettingsUpdate,
  type TurnCollaborationModeWarning,
} from "./turn-settings";
import type { ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import type { CollaborationMode, RequestedServiceTier } from "./model";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../conversation/turns/runtime-overrides";
import type { ChatAction, ChatState, ChatStateStore } from "../state/reducer";

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

type AutoReviewState = "enabled" | "disabled";
type FastModeState = "enabled" | "disabled";

export interface RuntimeSettingsActionsHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  addSystemMessage: (text: string) => void;
}

export interface ChatRuntimeSettingsActions {
  applyPendingThreadSettings: () => Promise<boolean>;
  requestModel: (model: string) => Promise<boolean>;
  resetModelToConfig: () => Promise<boolean>;
  requestModelFromUi: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<boolean>;
  resetReasoningEffortToConfig: () => Promise<boolean>;
  requestReasoningEffortFromUi: (effort: ReasoningEffort) => Promise<void>;
  resetReasoningEffortToConfigFromUi: () => Promise<void>;
  enableFastMode: () => Promise<void>;
  disableFastMode: () => Promise<void>;
  toggleFastMode: () => Promise<void>;
  toggleCollaborationMode: () => Promise<void>;
  setCollaborationMode: (collaborationMode: CollaborationMode) => Promise<boolean>;
  enableAutoReview: () => Promise<void>;
  disableAutoReview: () => Promise<void>;
  toggleAutoReview: () => Promise<void>;
}

export function createChatRuntimeSettingsActions(host: RuntimeSettingsActionsHost): ChatRuntimeSettingsActions {
  return {
    applyPendingThreadSettings: () => applyPendingThreadSettings(host),
    requestModel: (model) => requestModel(host, model),
    resetModelToConfig: () => resetModelToConfig(host),
    requestModelFromUi: (model) => requestModelFromUi(host, model),
    requestReasoningEffort: (effort) => requestReasoningEffort(host, effort),
    resetReasoningEffortToConfig: () => resetReasoningEffortToConfig(host),
    requestReasoningEffortFromUi: (effort) => requestReasoningEffortFromUi(host, effort),
    resetReasoningEffortToConfigFromUi: () => resetReasoningEffortToConfigFromUi(host),
    enableFastMode: () => setFastMode(host, "enabled"),
    disableFastMode: () => setFastMode(host, "disabled"),
    toggleFastMode: () => toggleFastMode(host),
    toggleCollaborationMode: () => toggleCollaborationMode(host),
    setCollaborationMode: (collaborationMode) => setCollaborationMode(host, collaborationMode),
    enableAutoReview: () => setAutoReview(host, "enabled"),
    disableAutoReview: () => setAutoReview(host, "disabled"),
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
    if (state(host).activeThread.id !== threadId) return { ok: false, collaborationModeApplied: false };
    dispatch(host, { type: "runtime/pending-thread-settings-committed", update });
    return { ok: true, collaborationModeApplied };
  } catch (error) {
    if (state(host).activeThread.id !== threadId) return { ok: false, collaborationModeApplied: false };
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return { ok: false, collaborationModeApplied: false };
  }
}

async function requestModel(host: RuntimeSettingsActionsHost, model: string): Promise<boolean> {
  dispatch(host, { type: "runtime/model-requested", model });
  return applyPendingThreadSettings(host);
}

async function resetModelToConfig(host: RuntimeSettingsActionsHost): Promise<boolean> {
  dispatch(host, { type: "runtime/model-reset-to-config" });
  return applyPendingThreadSettings(host);
}

async function requestModelFromUi(host: RuntimeSettingsActionsHost, model: string): Promise<void> {
  if (!(await requestModel(host, model))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(modelOverrideMessage(model));
}

async function requestReasoningEffort(host: RuntimeSettingsActionsHost, effort: ReasoningEffort): Promise<boolean> {
  dispatch(host, { type: "runtime/reasoning-effort-requested", effort });
  return applyPendingThreadSettings(host);
}

async function resetReasoningEffortToConfig(host: RuntimeSettingsActionsHost): Promise<boolean> {
  dispatch(host, { type: "runtime/reasoning-effort-reset-to-config" });
  return applyPendingThreadSettings(host);
}

async function requestReasoningEffortFromUi(host: RuntimeSettingsActionsHost, effort: ReasoningEffort): Promise<void> {
  if (!(await requestReasoningEffort(host, effort))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(reasoningEffortOverrideMessage(effort));
}

async function resetReasoningEffortToConfigFromUi(host: RuntimeSettingsActionsHost): Promise<void> {
  if (!(await resetReasoningEffortToConfig(host))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(reasoningEffortOverrideMessage(null));
}

async function toggleFastMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const snapshot = host.runtimeSnapshot();
  const config = runtimeConfigOrDefault(state(host).connection.runtimeConfig);
  await setFastMode(host, fastModeActive(snapshot, config) ? "disabled" : "enabled");
}

async function setFastMode(host: RuntimeSettingsActionsHost, mode: FastModeState): Promise<void> {
  const serviceTier: RequestedServiceTier = mode === "enabled" ? "fast" : "off";
  dispatch(host, { type: "runtime/service-tier-requested", serviceTier });
  dispatch(host, { type: "ui/panel-set", panel: null });
  if (!(await applyPendingThreadSettings(host))) return;
  host.addSystemMessage(fastModeToggleMessage(mode));
}

async function toggleCollaborationMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const next = nextCollaborationMode(state(host).runtime.selectedCollaborationMode);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsActionsHost, collaborationMode: CollaborationMode): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  dispatch(host, { type: "ui/panel-set", panel: null });
  const result = await applyPendingThreadSettingsResult(host);
  if (result.ok && result.collaborationModeApplied) host.addSystemMessage(collaborationModeToggleMessage(collaborationMode));
  return result.ok;
}

async function toggleAutoReview(host: RuntimeSettingsActionsHost): Promise<void> {
  const nextState = nextAutoReviewState(
    autoReviewActive(host.runtimeSnapshot(), runtimeConfigOrDefault(state(host).connection.runtimeConfig)),
  );
  await setAutoReview(host, nextState);
}

async function setAutoReview(host: RuntimeSettingsActionsHost, mode: AutoReviewState): Promise<void> {
  dispatch(host, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: autoReviewReviewerForState(mode) });
  dispatch(host, { type: "ui/panel-set", panel: null });
  if (!(await applyPendingThreadSettings(host))) return;
  host.addSystemMessage(autoReviewToggleMessage(mode));
}

function nextAutoReviewState(active: boolean): AutoReviewState {
  return active ? "disabled" : "enabled";
}

function autoReviewReviewerForState(state: AutoReviewState): ApprovalsReviewer {
  return state === "enabled" ? "auto_review" : "user";
}

function fastModeToggleMessage(state: FastModeState): string {
  return state === "enabled" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.";
}

function autoReviewToggleMessage(state: AutoReviewState): string {
  return state === "enabled" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.";
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
