import type { ReasoningEffort } from "../../../../domain/runtime/catalog";
import {
  type ReasoningEffortNormalization,
  reasoningEffortNormalizationForModel,
  unsupportedReasoningEffort,
  unsupportedReasoningEffortMessage,
} from "../../../../domain/runtime/catalog";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault, sameServiceTier } from "../../../../domain/runtime/settings";
import { createKeyedOperationCoordinator, type KeyedOperationCoordinator } from "../../../../shared/async/keyed-operation-coordinator";
import {
  type CollaborationModeSelection,
  nextCollaborationMode,
  type RequestedFastMode,
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
  unchangedRuntimeIntent,
} from "../../domain/runtime/intent";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { ActiveThreadRuntimeState, PendingRuntimeIntentState } from "../../domain/runtime/state";
import {
  pendingRuntimeSettingsPatch as buildPendingRuntimeSettingsPatch,
  type PendingRuntimeSettingsPatch,
} from "../../domain/runtime/thread-settings-patch";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatAction } from "../state/reducer";
import type { ChatStateStore } from "../state/store";

export interface RuntimeSettingsPort {
  updateThreadSettings(threadId: string, update: RuntimeSettingsPatch): Promise<boolean>;
}

interface RuntimeSettingsCommitResult {
  ok: boolean;
  collaborationModeApplied: boolean;
}

type AutoReviewState = "enabled" | "disabled";
type FastModeState = "enabled" | "disabled";

export interface RuntimeSettingsCommandsHost {
  stateStore: ChatStateStore;
  runtimeSettingsPort: RuntimeSettingsPort;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  addSystemMessage: (text: string) => void;
}

interface RuntimeSettingsCommandsContext extends RuntimeSettingsCommandsHost {
  threadCommits: KeyedOperationCoordinator<string>;
}

export interface ChatRuntimeSettingsCommands {
  applyPendingThreadSettings: () => Promise<boolean>;
  requestModel: (model: string) => Promise<boolean>;
  resetModelToConfig: () => Promise<boolean>;
  requestModelFromUi: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<boolean>;
  resetReasoningEffortToConfig: () => Promise<boolean>;
  requestReasoningEffortFromUi: (effort: ReasoningEffort) => Promise<void>;
  requestPermissionProfile: (permissionProfile: string) => Promise<boolean>;
  resetPermissionProfileToConfig: () => Promise<boolean>;
  toggleFastMode: () => Promise<void>;
  toggleCollaborationMode: () => Promise<void>;
  setCollaborationMode: (collaborationMode: CollaborationModeSelection) => Promise<boolean>;
  requestDefaultCollaborationModeForNextTurn: () => void;
  toggleAutoReview: () => Promise<void>;
}

export function createChatRuntimeSettingsCommands(
  host: RuntimeSettingsCommandsHost,
  threadCommits: KeyedOperationCoordinator<string> = createKeyedOperationCoordinator({ whenBusy: "queue" }),
): ChatRuntimeSettingsCommands {
  const context: RuntimeSettingsCommandsContext = { ...host, threadCommits };
  return {
    applyPendingThreadSettings: () => applyPendingThreadSettings(context),
    requestModel: (model) => requestModel(context, model),
    resetModelToConfig: () => resetModelToConfig(context),
    requestModelFromUi: (model) => requestModelFromUi(context, model),
    requestReasoningEffort: (effort) => requestReasoningEffort(context, effort),
    resetReasoningEffortToConfig: () => resetReasoningEffortToConfig(context),
    requestReasoningEffortFromUi: (effort) => requestReasoningEffortFromUi(context, effort),
    requestPermissionProfile: (permissionProfile) => requestPermissionProfile(context, permissionProfile),
    resetPermissionProfileToConfig: () => resetPermissionProfileToConfig(context),
    toggleFastMode: () => toggleFastMode(context),
    toggleCollaborationMode: () => toggleCollaborationMode(context),
    setCollaborationMode: (collaborationMode) => setCollaborationMode(context, collaborationMode),
    requestDefaultCollaborationModeForNextTurn: () => {
      requestDefaultCollaborationModeForNextTurn(context);
    },
    toggleAutoReview: () => toggleAutoReview(context),
  };
}

async function applyPendingThreadSettings(
  host: RuntimeSettingsCommandsContext,
  fields?: readonly (keyof PendingRuntimeIntentState)[],
): Promise<boolean> {
  return (await commitPendingThreadSettings(host, fields)).ok;
}

async function commitPendingThreadSettings(
  host: RuntimeSettingsCommandsContext,
  fields?: readonly (keyof PendingRuntimeIntentState)[],
): Promise<RuntimeSettingsCommitResult> {
  const target = capturePanelTargetLease(state(host));
  const threadId = activeThreadId(state(host));
  if (!threadId) return { ok: true, collaborationModeApplied: true };
  if (activePanelOperationBlocked(host, "thread-settings")) return { ok: false, collaborationModeApplied: false };
  const requested = state(host).runtime.pending;
  return host.threadCommits.run(threadId, async () => {
    let collaborationModeApplied = false;
    while (panelTargetLeaseIsCurrent(state(host), target)) {
      // UI commands report only their own intent. Turn submission reconciles all
      // outstanding intent through this same path, including changes during a send.
      const pending = state(host).runtime.pending;
      if (fields?.some((key) => pending[key] !== requested[key] && pending[key].kind !== "unchanged"))
        return { ok: false, collaborationModeApplied: false };
      const { update, intents, collaborationModeWarning } = pendingRuntimeSettingsPatch(host);
      if (collaborationModeWarning) reportCollaborationModeWarning(host);
      collaborationModeApplied ||= !collaborationModeWarning && "collaborationMode" in update;
      if (Object.keys(update).length === 0) return { ok: true, collaborationModeApplied };
      if (!(await updateRuntimeSettings(host, threadId, target, update)) || !panelTargetLeaseIsCurrent(state(host), target)) break;

      const current = state(host).runtime.pending;
      const requestedApplied = !fields || fields.every((key) => current[key] === requested[key] || current[key].kind === "unchanged");
      dispatch(host, { type: "runtime/pending-intent-confirmed", intents });
      if (fields) return { ok: requestedApplied, collaborationModeApplied: requestedApplied && collaborationModeApplied };
    }
    return { ok: false, collaborationModeApplied: false };
  });
}

async function updateRuntimeSettings(
  host: RuntimeSettingsCommandsContext,
  threadId: string,
  target: PanelTargetLease,
  update: RuntimeSettingsPatch,
): Promise<boolean> {
  const previous = state(host).runtime.active;
  let confirm!: () => void;
  let cancel!: () => void;
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  const cancelled = new Promise<false>((resolve) => {
    cancel = () => {
      resolve(false);
    };
  });
  const unsubscribe = host.stateStore.subscribe(() => {
    const current = state(host);
    if (
      !panelTargetLeaseIsCurrent(current, target) ||
      activeThreadId(current) !== threadId ||
      current.connection.phase.kind === "disconnected" ||
      current.connection.phase.kind === "failed"
    ) {
      cancel();
    } else if (current.runtime.active !== previous && runtimeSettingsMatch(current.runtime.active, update)) {
      // An ACK only queues the update. Its notification may precede the ACK.
      confirm();
    }
  });
  const timeout = window.setTimeout(() => {
    host.addSystemMessage("Timed out waiting for updated thread settings.");
    cancel();
  }, 10_000);
  try {
    const accepted = host.runtimeSettingsPort.updateThreadSettings(threadId, update);
    return await Promise.race([
      cancelled,
      accepted.then(async (ok) => {
        if (!ok) return false;
        await confirmed;
        return panelTargetLeaseIsCurrent(state(host), target);
      }),
    ]);
  } catch (error) {
    if (panelTargetLeaseIsCurrent(state(host), target)) {
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  } finally {
    window.clearTimeout(timeout);
    unsubscribe();
  }
}

function runtimeSettingsMatch(active: ActiveThreadRuntimeState, update: RuntimeSettingsPatch): boolean {
  return (
    (!("model" in update) || active.model === update.model) &&
    (!("effort" in update) || active.reasoningEffort === update.effort) &&
    (!("serviceTier" in update) || sameServiceTier(active.serviceTier, update.serviceTier)) &&
    (!("approvalsReviewer" in update) || active.approvalsReviewer === update.approvalsReviewer) &&
    (!("permissions" in update) || active.activePermissionProfile?.id === update.permissions) &&
    (!update.collaborationMode ||
      (active.collaborationMode === update.collaborationMode.mode &&
        active.model === update.collaborationMode.settings.model &&
        active.reasoningEffort === update.collaborationMode.settings.reasoningEffort))
  );
}

async function requestModel(host: RuntimeSettingsCommandsContext, model: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const normalization = normalizedReasoningEffortForModelChange(host, model);
  requestPendingRuntime(host, {
    model: setRuntimeIntentValue(model),
    ...(normalization.kind === "set" ? { reasoningEffort: setRuntimeIntentValue(normalization.effort) } : {}),
  });
  return applyPendingThreadSettings(host, modelUpdateFields(host));
}

async function resetModelToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const { config } = runtimeProjection(host);
  if (configuredResetUnavailable(host, config.model, "model")) return false;
  const normalization = normalizedReasoningEffortForModelChange(host, config.model);
  requestPendingRuntime(host, {
    model: config.model === null ? unchangedRuntimeIntent() : resetRuntimeIntentToConfig(),
    ...(normalization.kind === "set" ? { reasoningEffort: setRuntimeIntentValue(normalization.effort) } : {}),
  });
  return applyPendingThreadSettings(host, modelUpdateFields(host));
}

function modelUpdateFields(host: RuntimeSettingsCommandsHost): readonly (keyof PendingRuntimeIntentState)[] {
  return state(host).runtime.pending.reasoningEffort.kind === "unchanged" ? ["model"] : ["model", "reasoningEffort"];
}

function normalizedReasoningEffortForModelChange(host: RuntimeSettingsCommandsHost, model: string | null): ReasoningEffortNormalization {
  const { snapshot, config } = runtimeProjection(host);
  const effort = resolveRuntimeControls(snapshot, config).reasoningEffort.effective;
  return reasoningEffortNormalizationForModel(snapshot.availableModels, model, effort);
}

async function requestModelFromUi(host: RuntimeSettingsCommandsContext, model: string): Promise<void> {
  await runRuntimeUiCommand(host, () => requestModel(host, model), modelOverrideMessage(model));
}

async function requestReasoningEffort(host: RuntimeSettingsCommandsContext, effort: ReasoningEffort): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const { snapshot, config } = runtimeProjection(host);
  const selectedModel = resolveRuntimeControls(snapshot, config).model.effective;
  const unsupportedEffort = unsupportedReasoningEffort(snapshot.availableModels, selectedModel, effort);
  if (unsupportedEffort) {
    host.addSystemMessage(unsupportedReasoningEffortMessage(unsupportedEffort));
    return false;
  }
  requestPendingRuntime(host, { reasoningEffort: setRuntimeIntentValue(effort) });
  return applyPendingThreadSettings(host, ["reasoningEffort"]);
}

async function resetReasoningEffortToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const configured = runtimeProjection(host).config.reasoningEffort;
  if (configuredResetUnavailable(host, configured, "reasoning effort")) return false;
  requestPendingRuntime(host, { reasoningEffort: configured === null ? unchangedRuntimeIntent() : resetRuntimeIntentToConfig() });
  return applyPendingThreadSettings(host, ["reasoningEffort"]);
}

async function requestReasoningEffortFromUi(host: RuntimeSettingsCommandsContext, effort: ReasoningEffort): Promise<void> {
  await runRuntimeUiCommand(host, () => requestReasoningEffort(host, effort), reasoningEffortOverrideMessage(effort));
}

async function requestPermissionProfile(host: RuntimeSettingsCommandsContext, permissionProfile: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  requestPendingRuntime(host, { permissionProfile: setRuntimeIntentValue(permissionProfile) });
  return applyPendingThreadSettings(host, ["permissionProfile"]);
}

async function resetPermissionProfileToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  const configured = runtimeProjection(host).config.startupPermissions.activePermissionProfile?.id ?? null;
  if (configuredResetUnavailable(host, configured, "permission profile")) return false;
  requestPendingRuntime(host, { permissionProfile: configured === null ? unchangedRuntimeIntent() : resetRuntimeIntentToConfig() });
  return applyPendingThreadSettings(host, ["permissionProfile"]);
}

function configuredResetUnavailable(host: RuntimeSettingsCommandsHost, value: string | null, label: string): boolean {
  if (state(host).panelThread.kind === "empty" || value !== null) return false;
  host.addSystemMessage(`Cannot reset ${label}: no configured value is available. Choose an explicit value or start a new thread.`);
  return true;
}

function activePanelOperationBlocked(host: RuntimeSettingsCommandsHost, operation: ActivePanelOperation): boolean {
  const decision = activePanelOperationDecision(state(host), operation);
  if (decision.kind !== "blocked") return false;
  host.addSystemMessage(decision.message);
  return true;
}

async function toggleFastMode(host: RuntimeSettingsCommandsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  await setFastMode(host, resolveRuntimeControls(snapshot, config).fastMode.active ? "disabled" : "enabled");
}

async function setFastMode(host: RuntimeSettingsCommandsContext, mode: FastModeState): Promise<void> {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
  if (mode === "enabled") {
    const { snapshot, config } = runtimeProjection(host);
    if (!resolveRuntimeControls(snapshot, config).fastMode.available) {
      host.addSystemMessage("Fast mode is unavailable for the selected model.");
      return;
    }
  }
  const fastMode: RequestedFastMode = mode;
  await runRuntimeUiCommand(
    host,
    async () => {
      requestPendingRuntime(host, { fastMode: setRuntimeIntentValue(fastMode) });
      return applyPendingThreadSettings(host, ["fastMode"]);
    },
    mode === "enabled" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.",
  );
}

async function toggleCollaborationMode(host: RuntimeSettingsCommandsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const next = nextCollaborationMode(resolveRuntimeControls(snapshot, config).collaborationMode.effective);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsCommandsContext, collaborationMode: CollaborationModeSelection): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const target = capturePanelTargetLease(state(host));
  requestPendingRuntime(host, { collaborationMode: setCollaborationModeIntent(collaborationMode) });
  const result = await commitPendingThreadSettings(host, ["collaborationMode"]);
  if (!panelTargetLeaseIsCurrent(state(host), target)) return false;
  if (result.ok) closeRuntimePanel(host);
  if (result.ok && result.collaborationModeApplied) {
    host.addSystemMessage(collaborationMode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.");
  }
  return result.ok;
}

function requestDefaultCollaborationModeForNextTurn(host: RuntimeSettingsCommandsHost): void {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
  requestPendingRuntime(host, { collaborationMode: setCollaborationModeIntent("default") });
}

async function toggleAutoReview(host: RuntimeSettingsCommandsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const nextState = resolveRuntimeControls(snapshot, config).autoReview.active ? "disabled" : "enabled";
  await setAutoReview(host, nextState);
}

async function setAutoReview(host: RuntimeSettingsCommandsContext, mode: AutoReviewState): Promise<void> {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
  await runRuntimeUiCommand(
    host,
    async () => {
      requestPendingRuntime(host, {
        approvalsReviewer: setRuntimeIntentValue(mode === "enabled" ? "auto_review" : "user"),
      });
      return applyPendingThreadSettings(host, ["approvalsReviewer"]);
    },
    mode === "enabled" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.",
  );
}

async function runRuntimeUiCommand(
  host: RuntimeSettingsCommandsHost,
  command: () => Promise<boolean>,
  successMessage: string,
): Promise<void> {
  const target = capturePanelTargetLease(state(host));
  if (!(await command()) || !panelTargetLeaseIsCurrent(state(host), target)) return;
  closeRuntimePanel(host);
  host.addSystemMessage(successMessage);
}

function closeRuntimePanel(host: RuntimeSettingsCommandsHost): void {
  dispatch(host, { type: "ui/panel-set", panel: null });
}

function requestPendingRuntime(host: RuntimeSettingsCommandsHost, patch: Partial<PendingRuntimeIntentState>): void {
  dispatch(host, { type: "runtime/pending-intent-patched", patch });
}

function pendingRuntimeSettingsPatch(host: RuntimeSettingsCommandsHost): PendingRuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  return buildPendingRuntimeSettingsPatch(snapshot, config);
}

function reportCollaborationModeWarning(host: RuntimeSettingsCommandsHost): void {
  host.addSystemMessage(
    `${host.collaborationModeLabel()} mode is selected, but No effective model is available. Sending without a mode override.`,
  );
}

function runtimeProjection(host: RuntimeSettingsCommandsHost): {
  snapshot: RuntimeSnapshot;
  config: RuntimeConfigSnapshot;
} {
  const current = state(host);
  const snapshot = host.runtimeSnapshotForState(current);
  return {
    snapshot,
    config: runtimeConfigOrDefault(snapshot.runtimeConfig),
  };
}

function state(host: RuntimeSettingsCommandsHost): ChatState {
  return host.stateStore.getState();
}

function dispatch(host: RuntimeSettingsCommandsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}
