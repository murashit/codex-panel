import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import { type CollaborationModeSelection, nextCollaborationMode, type RequestedFastMode } from "../../domain/runtime/intent";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import {
  pendingRuntimeSettingsPatch as buildPendingRuntimeSettingsPatch,
  type PendingRuntimeSettingsPatch,
} from "../../domain/runtime/thread-settings-patch";
import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { RuntimeSettingsTransport } from "./settings-transport";

interface RuntimeSettingsCommitResult {
  ok: boolean;
  collaborationModeApplied: boolean;
}

type AutoReviewState = "enabled" | "disabled";
type FastModeState = "enabled" | "disabled";

export interface RuntimeSettingsActionsHost {
  stateStore: ChatStateStore;
  runtimeTransport: RuntimeSettingsTransport;
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
  setCollaborationMode: (collaborationMode: CollaborationModeSelection) => Promise<boolean>;
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
  return (await commitPendingThreadSettings(host)).ok;
}

async function commitPendingThreadSettings(host: RuntimeSettingsActionsHost): Promise<RuntimeSettingsCommitResult> {
  const threadId = state(host).activeThread.id;
  if (!threadId) return { ok: true, collaborationModeApplied: true };

  const { update, collaborationModeWarning } = pendingRuntimeSettingsPatch(host);
  if (collaborationModeWarning) reportCollaborationModeWarning(host, collaborationModeWarning);
  const collaborationModeApplied = !collaborationModeWarning && "collaborationMode" in update;
  if (Object.keys(update).length === 0) return { ok: true, collaborationModeApplied };

  try {
    if (!(await host.runtimeTransport.updateThreadSettings(threadId, update))) {
      return { ok: false, collaborationModeApplied: false };
    }
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
  await runRuntimeUiCommand(host, () => requestModel(host, model), modelOverrideMessage(model));
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
  await runRuntimeUiCommand(host, () => requestReasoningEffort(host, effort), reasoningEffortOverrideMessage(effort));
}

async function resetReasoningEffortToConfigFromUi(host: RuntimeSettingsActionsHost): Promise<void> {
  await runRuntimeUiCommand(host, () => resetReasoningEffortToConfig(host), reasoningEffortOverrideMessage(null));
}

async function toggleFastMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  await setFastMode(host, resolveRuntimeControls(snapshot, config).fastMode.active ? "disabled" : "enabled");
}

async function setFastMode(host: RuntimeSettingsActionsHost, mode: FastModeState): Promise<void> {
  const fastMode: RequestedFastMode = mode;
  await runRuntimeUiCommand(
    host,
    async () => {
      dispatch(host, { type: "runtime/fast-mode-requested", fastMode });
      return applyPendingThreadSettings(host);
    },
    mode === "enabled" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.",
  );
}

async function toggleCollaborationMode(host: RuntimeSettingsActionsHost): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const next = nextCollaborationMode(resolveRuntimeControls(snapshot, config).collaborationMode.effective);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsActionsHost, collaborationMode: CollaborationModeSelection): Promise<boolean> {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  const result = await commitPendingThreadSettings(host);
  if (result.ok) closeRuntimePanel(host);
  if (result.ok && result.collaborationModeApplied) {
    host.addSystemMessage(collaborationMode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.");
  }
  return result.ok;
}

function requestDefaultCollaborationModeForNextTurn(host: RuntimeSettingsActionsHost): void {
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
}

async function toggleAutoReview(host: RuntimeSettingsActionsHost): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const nextState = resolveRuntimeControls(snapshot, config).autoReview.active ? "disabled" : "enabled";
  await setAutoReview(host, nextState);
}

async function setAutoReview(host: RuntimeSettingsActionsHost, mode: AutoReviewState): Promise<void> {
  await runRuntimeUiCommand(
    host,
    async () => {
      dispatch(host, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: mode === "enabled" ? "auto_review" : "user" });
      return applyPendingThreadSettings(host);
    },
    mode === "enabled" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.",
  );
}

async function runRuntimeUiCommand(
  host: RuntimeSettingsActionsHost,
  command: () => Promise<boolean>,
  successMessage: string,
): Promise<void> {
  if (!(await command())) return;
  closeRuntimePanel(host);
  host.addSystemMessage(successMessage);
}

function closeRuntimePanel(host: RuntimeSettingsActionsHost): void {
  dispatch(host, { type: "ui/panel-set", panel: null });
}

function pendingRuntimeSettingsPatch(host: RuntimeSettingsActionsHost): PendingRuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  return buildPendingRuntimeSettingsPatch(snapshot, config);
}

function reportCollaborationModeWarning(
  host: RuntimeSettingsActionsHost,
  warning: NonNullable<PendingRuntimeSettingsPatch["collaborationModeWarning"]>,
): void {
  void warning;
  host.addSystemMessage(
    `${host.collaborationModeLabel()} mode is selected, but No effective model is available. Sending without a mode override.`,
  );
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
    leftKeys.every((key) => Object.hasOwn(right, key) && threadSettingsValueEqual(left[key], right[key]))
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
