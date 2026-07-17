import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import { createKeyedOperationQueue, type KeyedOperationQueue } from "../../../../shared/runtime/keyed-operation-queue";
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
import {
  createRuntimeSettingsCommitCoordinator,
  type RuntimeSettingsCommitCoordinator,
  type RuntimeSettingsCommitTarget,
} from "./runtime-settings-commit-coordinator";
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

interface RuntimeSettingsActionsContext extends RuntimeSettingsActionsHost {
  runtimeSettingsCommits: RuntimeSettingsCommitCoordinator;
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

export function createChatRuntimeSettingsActions(
  host: RuntimeSettingsActionsHost,
  threadCommits: KeyedOperationQueue<string> = createKeyedOperationQueue(),
): ChatRuntimeSettingsActions {
  const runtimeSettingsCommits = createRuntimeSettingsCommitCoordinator(
    {
      scopeIsCurrent: (scope) => {
        const currentState = state(host);
        return (
          activeThreadId(currentState) === scope.threadId &&
          panelTargetLeaseIsCurrent(currentState, {
            revision: scope.panelTargetRevision,
            target: { kind: "thread", threadId: scope.threadId },
          })
        );
      },
      pendingPatch: () => currentPendingRuntimeSettingsPatch(host),
      updateThreadSettings: (threadId, update) => host.runtimeTransport.updateThreadSettings(threadId, update),
      commitPatch: (update) => {
        dispatch(host, { type: "runtime/pending-thread-settings-committed", update });
      },
      reportError: (error) => {
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
      },
    },
    threadCommits,
  );
  const context: RuntimeSettingsActionsContext = { ...host, runtimeSettingsCommits };
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
  host: RuntimeSettingsActionsContext,
  fields?: readonly (keyof RuntimeSettingsPatch)[],
): Promise<boolean> {
  return (await commitPendingThreadSettings(host, fields)).ok;
}

async function commitPendingThreadSettings(
  host: RuntimeSettingsActionsContext,
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
  const target = runtimeSettingsCommitTarget(update, fields);
  const ok = await host.runtimeSettingsCommits.commit({ threadId, panelTargetRevision: panelTarget.revision }, target);
  return { ok, collaborationModeApplied: ok && collaborationModeApplied };
}

async function requestModel(host: RuntimeSettingsActionsContext, model: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/model-requested", model });
  return applyPendingThreadSettings(host, ["model"]);
}

async function resetModelToConfig(host: RuntimeSettingsActionsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/model-reset-to-config" });
  return applyPendingThreadSettings(host, ["model"]);
}

async function requestModelFromUi(host: RuntimeSettingsActionsContext, model: string): Promise<void> {
  await runRuntimeUiCommand(host, () => requestModel(host, model), modelOverrideMessage(model));
}

async function requestReasoningEffort(host: RuntimeSettingsActionsContext, effort: ReasoningEffort): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/reasoning-effort-requested", effort });
  return applyPendingThreadSettings(host, ["effort"]);
}

async function resetReasoningEffortToConfig(host: RuntimeSettingsActionsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/reasoning-effort-reset-to-config" });
  return applyPendingThreadSettings(host, ["effort"]);
}

async function requestReasoningEffortFromUi(host: RuntimeSettingsActionsContext, effort: ReasoningEffort): Promise<void> {
  await runRuntimeUiCommand(host, () => requestReasoningEffort(host, effort), reasoningEffortOverrideMessage(effort));
}

async function resetReasoningEffortToConfigFromUi(host: RuntimeSettingsActionsContext): Promise<void> {
  await runRuntimeUiCommand(host, () => resetReasoningEffortToConfig(host), reasoningEffortOverrideMessage(null));
}

async function requestPermissionProfile(host: RuntimeSettingsActionsContext, permissionProfile: string): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  dispatch(host, { type: "runtime/permission-profile-requested", permissionProfile });
  return applyPendingThreadSettings(host, ["permissions"]);
}

async function resetPermissionProfileToConfig(host: RuntimeSettingsActionsContext): Promise<boolean> {
  if (activePanelOperationBlocked(host, "permission-settings")) return false;
  dispatch(host, { type: "runtime/permission-profile-reset-to-config" });
  return applyPendingThreadSettings(host, ["permissions"]);
}

function activePanelOperationBlocked(host: RuntimeSettingsActionsHost, operation: ActivePanelOperation): boolean {
  const decision = activePanelOperationDecision(state(host), operation);
  if (decision.kind !== "blocked") return false;
  host.addSystemMessage(decision.message);
  return true;
}

async function toggleFastMode(host: RuntimeSettingsActionsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  await setFastMode(host, resolveRuntimeControls(snapshot, config).fastMode.active ? "disabled" : "enabled");
}

async function setFastMode(host: RuntimeSettingsActionsContext, mode: FastModeState): Promise<void> {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
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

async function toggleCollaborationMode(host: RuntimeSettingsActionsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const next = nextCollaborationMode(resolveRuntimeControls(snapshot, config).collaborationMode.effective);
  await setCollaborationMode(host, next);
}

async function setCollaborationMode(host: RuntimeSettingsActionsContext, collaborationMode: CollaborationModeSelection): Promise<boolean> {
  if (activePanelOperationBlocked(host, "thread-settings")) return false;
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode });
  const result = await commitPendingThreadSettings(host, ["collaborationMode"]);
  if (result.ok) closeRuntimePanel(host);
  if (result.ok && result.collaborationModeApplied) {
    host.addSystemMessage(collaborationMode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.");
  }
  return result.ok;
}

function requestDefaultCollaborationModeForNextTurn(host: RuntimeSettingsActionsHost): void {
  if (activePanelOperationBlocked(host, "thread-settings")) return;
  dispatch(host, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
}

async function toggleAutoReview(host: RuntimeSettingsActionsContext): Promise<void> {
  const { snapshot, config } = runtimeProjection(host);
  const nextState = resolveRuntimeControls(snapshot, config).autoReview.active ? "disabled" : "enabled";
  await setAutoReview(host, nextState);
}

async function setAutoReview(host: RuntimeSettingsActionsContext, mode: AutoReviewState): Promise<void> {
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

function runtimeSettingsCommitTarget(
  update: RuntimeSettingsPatch,
  fields: readonly (keyof RuntimeSettingsPatch)[] | undefined,
): RuntimeSettingsCommitTarget {
  if (!fields) return { kind: "settle" };
  const targetedUpdate: RuntimeSettingsPatch = {};
  for (const key of fields) {
    if (key in update) Object.assign(targetedUpdate, { [key]: update[key] });
  }
  return Object.keys(targetedUpdate).length === 0 ? { kind: "settle" } : { kind: "fields", update: targetedUpdate };
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
