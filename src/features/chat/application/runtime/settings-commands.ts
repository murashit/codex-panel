import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import {
  type ReasoningEffortNormalization,
  reasoningEffortNormalizationForModel,
  unsupportedReasoningEffort,
  unsupportedReasoningEffortMessage,
} from "../../../../domain/catalog/reasoning-effort-compatibility";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import { createKeyedOperationCoordinator, type KeyedOperationCoordinator } from "../../../../shared/async/keyed-operation-coordinator";
import { type CollaborationModeSelection, nextCollaborationMode, type RequestedFastMode } from "../../domain/runtime/intent";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import {
  pendingRuntimeSettingsPatch as buildPendingRuntimeSettingsPatch,
  type PendingRuntimeSettingsPatch,
} from "../../domain/runtime/thread-settings-patch";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, type ChatAction, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { RuntimeSettingsPort } from "./settings-port";

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

interface RuntimeSettingsCommandScope {
  readonly threadId: string;
  readonly panelTargetRevision: number;
}

export interface ChatRuntimeSettingsCommands {
  applyPendingThreadSettings: () => Promise<boolean>;
  requestModel: (model: string) => Promise<boolean>;
  resetModelToConfig: () => Promise<boolean>;
  requestModelFromUi: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<boolean>;
  resetReasoningEffortToConfig: () => Promise<boolean>;
  requestReasoningEffortFromUi: (effort: ReasoningEffort) => Promise<void>;
  resetReasoningEffortToConfigFromUi: () => Promise<void>;
  requestPermissionProfile: (permissionProfile: string) => Promise<boolean>;
  resetPermissionProfileToConfig: () => Promise<boolean>;
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
    resetReasoningEffortToConfigFromUi: () => resetReasoningEffortToConfigFromUi(context),
    requestPermissionProfile: (permissionProfile) => requestPermissionProfile(context, permissionProfile),
    resetPermissionProfileToConfig: () => resetPermissionProfileToConfig(context),
    enableFastMode: () => setFastMode(context, "enabled"),
    disableFastMode: () => setFastMode(context, "disabled"),
    toggleFastMode: () => toggleFastMode(context),
    toggleCollaborationMode: () => toggleCollaborationMode(context),
    setCollaborationMode: (collaborationMode) => setCollaborationMode(context, collaborationMode),
    requestDefaultCollaborationModeForNextTurn: () => {
      requestDefaultCollaborationModeForNextTurn(context);
    },
    enableAutoReview: () => setAutoReview(context, "enabled"),
    disableAutoReview: () => setAutoReview(context, "disabled"),
    toggleAutoReview: () => toggleAutoReview(context),
  };
}

async function applyPendingThreadSettings(
  host: RuntimeSettingsCommandsContext,
  fields?: readonly (keyof RuntimeSettingsPatch)[],
): Promise<boolean> {
  return (await commitPendingThreadSettings(host, fields)).ok;
}

async function commitPendingThreadSettings(
  host: RuntimeSettingsCommandsContext,
  fields?: readonly (keyof RuntimeSettingsPatch)[],
): Promise<RuntimeSettingsCommitResult> {
  const threadId = activeThreadId(state(host));
  if (!threadId) return { ok: true, collaborationModeApplied: true };
  const panelTarget = capturePanelTargetLease(state(host));

  const { update, collaborationModeWarning } = pendingRuntimeSettingsPatch(host);
  if (collaborationModeWarning) reportCollaborationModeWarning(host, collaborationModeWarning);
  const collaborationModeApplied = !collaborationModeWarning && "collaborationMode" in update;
  if (Object.keys(update).length === 0) return { ok: true, collaborationModeApplied };

  if (activePanelOperationBlocked(host, "thread-settings")) return { ok: false, collaborationModeApplied: false };
  const scope = { threadId, panelTargetRevision: panelTarget.revision };
  const ok = fields
    ? await commitRuntimeSettingsFields(host, scope, pickRuntimeSettingsFields(update, fields))
    : await settleRuntimeSettings(host, scope);
  return { ok, collaborationModeApplied: ok && collaborationModeApplied };
}

function commitRuntimeSettingsFields(
  host: RuntimeSettingsCommandsContext,
  scope: RuntimeSettingsCommandScope,
  update: RuntimeSettingsPatch,
): Promise<boolean> {
  if (patchEmpty(update)) return Promise.resolve(true);
  const command = { ...update };
  return host.threadCommits.run(scope.threadId, async () => {
    if (!runtimeSettingsScopeIsCurrent(host, scope)) return false;
    if (!patchEqual(matchingPendingPatch(currentPendingRuntimeSettingsPatch(host), command), command)) return false;

    const updated = await updateRuntimeSettings(host, scope, command);
    if (!updated || !runtimeSettingsScopeIsCurrent(host, scope)) return false;

    const committed = matchingPendingPatch(currentPendingRuntimeSettingsPatch(host), command);
    if ("model" in command && committed.model !== command.model) return false;
    if (!patchEmpty(committed)) commitRuntimeSettingsPatch(host, committed);
    return patchEqual(committed, command);
  });
}

async function settleRuntimeSettings(host: RuntimeSettingsCommandsContext, scope: RuntimeSettingsCommandScope): Promise<boolean> {
  while (runtimeSettingsScopeIsCurrent(host, scope)) {
    const result = await host.threadCommits.run(scope.threadId, async (): Promise<"continue" | "failed" | "settled"> => {
      if (!runtimeSettingsScopeIsCurrent(host, scope)) return "failed";
      const update = currentPendingRuntimeSettingsPatch(host);
      if (patchEmpty(update)) return "settled";

      if (!(await updateRuntimeSettings(host, scope, update)) || !runtimeSettingsScopeIsCurrent(host, scope)) return "failed";

      const committed = matchingPendingPatch(currentPendingRuntimeSettingsPatch(host), update);
      if (!patchEmpty(committed)) commitRuntimeSettingsPatch(host, committed);
      return patchEmpty(currentPendingRuntimeSettingsPatch(host)) ? "settled" : "continue";
    });
    if (result !== "continue") return result === "settled";
  }
  return false;
}

async function updateRuntimeSettings(
  host: RuntimeSettingsCommandsContext,
  scope: RuntimeSettingsCommandScope,
  update: RuntimeSettingsPatch,
): Promise<boolean> {
  try {
    return await host.runtimeSettingsPort.updateThreadSettings(scope.threadId, update);
  } catch (error) {
    if (runtimeSettingsScopeIsCurrent(host, scope)) {
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

function runtimeSettingsScopeIsCurrent(host: RuntimeSettingsCommandsHost, scope: RuntimeSettingsCommandScope): boolean {
  const currentState = state(host);
  return (
    activeThreadId(currentState) === scope.threadId &&
    panelTargetLeaseIsCurrent(currentState, {
      revision: scope.panelTargetRevision,
      target: { kind: "thread", threadId: scope.threadId },
    })
  );
}

function commitRuntimeSettingsPatch(host: RuntimeSettingsCommandsHost, update: RuntimeSettingsPatch): void {
  dispatch(host, { type: "runtime/pending-thread-settings-committed", update });
}

async function requestModel(host: RuntimeSettingsCommandsContext, model: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const normalization = normalizedReasoningEffortForModelChange(host, model);
  dispatch(host, { type: "runtime/model-requested", model });
  if (normalization.kind === "set") dispatch(host, { type: "runtime/reasoning-effort-requested", effort: normalization.effort });
  return applyPendingThreadSettings(host, modelUpdateFields(host));
}

async function resetModelToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  const { config } = runtimeProjection(host);
  const normalization = normalizedReasoningEffortForModelChange(host, config.model);
  dispatch(host, { type: "runtime/model-reset-to-config" });
  if (normalization.kind === "set") dispatch(host, { type: "runtime/reasoning-effort-requested", effort: normalization.effort });
  return applyPendingThreadSettings(host, modelUpdateFields(host));
}

function modelUpdateFields(host: RuntimeSettingsCommandsHost): readonly (keyof RuntimeSettingsPatch)[] {
  return state(host).runtime.pending.reasoningEffort.kind === "unchanged" ? ["model"] : ["model", "effort"];
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
  dispatch(host, { type: "runtime/reasoning-effort-requested", effort });
  return applyPendingThreadSettings(host, ["effort"]);
}

async function resetReasoningEffortToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/reasoning-effort-reset-to-config" });
  return applyPendingThreadSettings(host, ["effort"]);
}

async function requestReasoningEffortFromUi(host: RuntimeSettingsCommandsContext, effort: ReasoningEffort): Promise<void> {
  await runRuntimeUiCommand(host, () => requestReasoningEffort(host, effort), reasoningEffortOverrideMessage(effort));
}

async function resetReasoningEffortToConfigFromUi(host: RuntimeSettingsCommandsContext): Promise<void> {
  await runRuntimeUiCommand(host, () => resetReasoningEffortToConfig(host), reasoningEffortOverrideMessage(null));
}

async function requestPermissionProfile(host: RuntimeSettingsCommandsContext, permissionProfile: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  dispatch(host, { type: "runtime/permission-profile-requested", permissionProfile });
  return applyPendingThreadSettings(host, ["permissions"]);
}

async function resetPermissionProfileToConfig(host: RuntimeSettingsCommandsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  dispatch(host, { type: "runtime/permission-profile-reset-to-config" });
  return applyPendingThreadSettings(host, ["permissions"]);
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
      dispatch(host, { type: "runtime/fast-mode-requested", fastMode });
      return applyPendingThreadSettings(host, ["serviceTier"]);
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
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  const result = await commitPendingThreadSettings(host, ["collaborationMode"]);
  if (result.ok) closeRuntimePanel(host);
  if (result.ok && result.collaborationModeApplied) {
    host.addSystemMessage(collaborationMode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.");
  }
  return result.ok;
}

function requestDefaultCollaborationModeForNextTurn(host: RuntimeSettingsCommandsHost): void {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
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
      dispatch(host, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: mode === "enabled" ? "auto_review" : "user" });
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
  if (!(await command())) return;
  closeRuntimePanel(host);
  host.addSystemMessage(successMessage);
}

function closeRuntimePanel(host: RuntimeSettingsCommandsHost): void {
  dispatch(host, { type: "ui/panel-set", panel: null });
}

function pendingRuntimeSettingsPatch(host: RuntimeSettingsCommandsHost): PendingRuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  return buildPendingRuntimeSettingsPatch(snapshot, config);
}

function reportCollaborationModeWarning(
  host: RuntimeSettingsCommandsHost,
  warning: NonNullable<PendingRuntimeSettingsPatch["collaborationModeWarning"]>,
): void {
  void warning;
  host.addSystemMessage(
    `${host.collaborationModeLabel()} mode is selected, but No effective model is available. Sending without a mode override.`,
  );
}

function currentPendingRuntimeSettingsPatch(host: RuntimeSettingsCommandsHost): RuntimeSettingsPatch {
  const { snapshot, config } = runtimeProjection(host);
  return buildPendingRuntimeSettingsPatch(snapshot, config).update;
}

function pickRuntimeSettingsFields(update: RuntimeSettingsPatch, fields: readonly (keyof RuntimeSettingsPatch)[]): RuntimeSettingsPatch {
  const targetedUpdate: RuntimeSettingsPatch = {};
  for (const key of fields) {
    if (key in update) Object.assign(targetedUpdate, { [key]: update[key] });
  }
  return targetedUpdate;
}

function matchingPendingPatch(current: RuntimeSettingsPatch, sent: RuntimeSettingsPatch): RuntimeSettingsPatch {
  const matching: RuntimeSettingsPatch = {};
  for (const key of patchKeys(sent)) {
    if (key in current && threadSettingsValueEqual(current[key], sent[key])) {
      Object.assign(matching, { [key]: sent[key] });
    }
  }
  return matching;
}

function patchEqual(left: RuntimeSettingsPatch, right: RuntimeSettingsPatch): boolean {
  const leftKeys = patchKeys(left);
  const rightKeys = patchKeys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && threadSettingsValueEqual(left[key], right[key]));
}

function patchEmpty(patch: RuntimeSettingsPatch): boolean {
  return patchKeys(patch).length === 0;
}

function patchKeys(patch: RuntimeSettingsPatch): (keyof RuntimeSettingsPatch)[] {
  return Object.keys(patch) as (keyof RuntimeSettingsPatch)[];
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
