import type { AppServerClient } from "../../../../app-server/connection/client";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { ApprovalsReviewer } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { autoReviewActive, fastModeActive, runtimeConfigOrDefault } from "../../domain/runtime/effective";
import {
  pendingRuntimeSettingsPatch as buildPendingRuntimeSettingsPatch,
  type PendingRuntimeSettingsPatch,
} from "./thread-settings-update";
import type { RuntimeSnapshot } from "./snapshot";
import { nextCollaborationMode, type CollaborationMode, type RequestedServiceTier } from "../../domain/runtime/pending-settings";
import {
  autoReviewToggleMessage,
  collaborationModeToggleMessage,
  collaborationModeWarningMessage,
  fastModeToggleMessage,
  modelOverrideMessage,
  reasoningEffortOverrideMessage,
} from "./messages";
import type { ChatAction, ChatState, ChatStateStore } from "../state/reducer";

interface ApplyPendingThreadSettingsResult {
  ok: boolean;
  collaborationModeApplied: boolean;
}

type AutoReviewState = "enabled" | "disabled";
type FastModeState = "enabled" | "disabled";

export interface RuntimeSettingsActionsHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
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
  requestDefaultCollaborationModeForNextTurn: () => void;
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
    requestDefaultCollaborationModeForNextTurn: () => {
      requestDefaultCollaborationModeForNextTurn(host);
    },
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

  const { update, collaborationModeWarning } = pendingRuntimeSettingsPatch(host);
  const collaborationModeApplied = !collaborationModeWarning && "collaborationMode" in update;
  if (Object.keys(update).length === 0) return { ok: true, collaborationModeApplied };

  try {
    await client.updateThreadSettings(threadId, update);
    if (state(host).activeThread.id !== threadId) return { ok: false, collaborationModeApplied: false };
    if (!runtimeSettingsPatchStillPending(currentPendingRuntimeSettingsPatch(host), update)) {
      return { ok: false, collaborationModeApplied: false };
    }
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
  const { snapshot, config } = runtimeProjection(host);
  await setFastMode(host, fastModeActive(snapshot, config) ? "disabled" : "enabled");
}

async function setFastMode(host: RuntimeSettingsActionsHost, mode: FastModeState): Promise<void> {
  const serviceTier: RequestedServiceTier = mode === "enabled" ? "fast" : "off";
  dispatch(host, { type: "runtime/service-tier-requested", serviceTier });
  if (!(await applyPendingThreadSettings(host))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(fastModeToggleMessage(mode));
}

async function toggleCollaborationMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const current = state(host);
  const next = nextCollaborationMode(current.runtime.selectedCollaborationMode);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsActionsHost, collaborationMode: CollaborationMode): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  const result = await applyPendingThreadSettingsResult(host);
  if (result.ok) dispatch(host, { type: "ui/panel-set", panel: null });
  if (result.ok && result.collaborationModeApplied) host.addSystemMessage(collaborationModeToggleMessage(collaborationMode));
  return result.ok;
}

function requestDefaultCollaborationModeForNextTurn(host: RuntimeSettingsActionsHost): void {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
}

async function toggleAutoReview(host: RuntimeSettingsActionsHost): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const nextState = nextAutoReviewState(autoReviewActive(snapshot, config));
  await setAutoReview(host, nextState);
}

async function setAutoReview(host: RuntimeSettingsActionsHost, mode: AutoReviewState): Promise<void> {
  dispatch(host, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: autoReviewReviewerForState(mode) });
  if (!(await applyPendingThreadSettings(host))) return;
  dispatch(host, { type: "ui/panel-set", panel: null });
  host.addSystemMessage(autoReviewToggleMessage(mode));
}

function nextAutoReviewState(active: boolean): AutoReviewState {
  return active ? "disabled" : "enabled";
}

function autoReviewReviewerForState(state: AutoReviewState): ApprovalsReviewer {
  return state === "enabled" ? "auto_review" : "user";
}

function pendingRuntimeSettingsPatch(host: RuntimeSettingsActionsHost): PendingRuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  const { update, collaborationModeWarning } = buildPendingRuntimeSettingsPatch(snapshot, config);
  if (collaborationModeWarning) {
    host.addSystemMessage(
      `${host.collaborationModeLabel()} mode is selected, but ${collaborationModeWarningMessage(collaborationModeWarning)}`,
    );
  }
  return { update, collaborationModeWarning };
}

function currentPendingRuntimeSettingsPatch(host: RuntimeSettingsActionsHost): RuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  return buildPendingRuntimeSettingsPatch(snapshot, config).update;
}

function runtimeSettingsPatchStillPending(current: RuntimeSettingsPatch, applied: RuntimeSettingsPatch): boolean {
  return (Object.keys(applied) as (keyof RuntimeSettingsPatch)[]).every((key) => {
    return key in current && threadSettingsValueEqual(current[key], applied[key]);
  });
}

function threadSettingsValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => threadSettingsValueEqual(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && threadSettingsValueEqual(left[key], right[key]))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function runtimeProjection(host: RuntimeSettingsActionsHost): {
  snapshot: RuntimeSnapshot;
  config: RuntimeConfigSnapshot;
} {
  const current = state(host);
  return {
    snapshot: host.runtimeSnapshotForState(current),
    config: runtimeConfigOrDefault(current.connection.runtimeConfig),
  };
}

function state(host: RuntimeSettingsActionsHost): ChatState {
  return host.stateStore.getState();
}

function dispatch(host: RuntimeSettingsActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}
