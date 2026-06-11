import { applyThreadSettingsValue, appServerCollaborationMode, type ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import type { ServiceTierRequest } from "../../../app-server/thread-settings";
import {
  currentModel,
  currentReasoningEffort,
  fastServiceTierRequestValue,
  runtimeConfigOrDefault,
  type RuntimeSnapshot,
} from "./effective-settings";
import type { RuntimeConfigSnapshot } from "../../../app-server/runtime-config";
import { clearedServiceTierRequestValue, serviceTierRequestValue } from "../../../app-server/thread-settings";
import { pendingRuntimeSettingPayload, type CollaborationMode } from "./model";

export type TurnCollaborationModeWarning = "missing-model";

export interface TurnCollaborationModeSettings {
  collaborationMode: ThreadSettingsUpdate["collaborationMode"] | null;
  warning: TurnCollaborationModeWarning | null;
}

export interface PendingThreadSettingsUpdate {
  update: ThreadSettingsUpdate;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function nextCollaborationMode(mode: CollaborationMode): CollaborationMode {
  return mode === "plan" ? "default" : "plan";
}

export function collaborationModeLabel(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function collaborationModeToggleMessage(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.";
}

export function serviceTierRequestForThreadStart(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot = runtimeConfigOrDefault(snapshot.runtimeConfig),
): ServiceTierRequest {
  if (snapshot.requestedServiceTier.kind === "set") {
    return snapshot.requestedServiceTier.value === "fast"
      ? serviceTierRequestValue(fastServiceTierRequestValue(snapshot, config))
      : clearedServiceTierRequestValue();
  }
  if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    return clearedServiceTierRequestValue();
  }
  return config.serviceTier ?? undefined;
}

export function requestedTurnCollaborationModeSettings(snapshot: RuntimeSnapshot): TurnCollaborationModeSettings {
  const model = currentModel(snapshot);
  const effort = currentReasoningEffort(snapshot);
  const collaborationMode = model ? collaborationModePayload(snapshot.selectedCollaborationMode, model, effort) : null;
  return {
    collaborationMode,
    warning: model ? null : "missing-model",
  };
}

export function pendingThreadSettingsUpdate(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot = runtimeConfigOrDefault(snapshot.runtimeConfig),
): PendingThreadSettingsUpdate {
  const update: ThreadSettingsUpdate = {};
  const collaborationModeSettings = requestedTurnCollaborationModeSettings(snapshot);

  if (snapshot.requestedModel.kind !== "unchanged") {
    applyThreadSettingsValue(update, "model", pendingRuntimeSettingPayload(snapshot.requestedModel));
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    applyThreadSettingsValue(update, "effort", pendingRuntimeSettingPayload(snapshot.requestedReasoningEffort));
  }
  if (snapshot.requestedServiceTier.kind === "set") {
    applyThreadSettingsValue(
      update,
      "serviceTier",
      snapshot.requestedServiceTier.value === "fast"
        ? serviceTierRequestValue(fastServiceTierRequestValue(snapshot, config))
        : clearedServiceTierRequestValue(),
    );
  } else if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    applyThreadSettingsValue(update, "serviceTier", clearedServiceTierRequestValue());
  }
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    applyThreadSettingsValue(update, "approvalsReviewer", pendingRuntimeSettingPayload(snapshot.requestedApprovalsReviewer));
  }
  if (snapshot.selectedCollaborationMode !== snapshot.activeCollaborationMode) {
    if (collaborationModeSettings.warning) {
      return { update, collaborationModeWarning: collaborationModeSettings.warning };
    }
    applyThreadSettingsValue(update, "collaborationMode", collaborationModeSettings.collaborationMode ?? undefined);
  }
  return { update, collaborationModeWarning: null };
}

function collaborationModePayload(
  mode: RuntimeSnapshot["selectedCollaborationMode"],
  model: string,
  reasoningEffort: ReturnType<typeof currentReasoningEffort>,
): NonNullable<ThreadSettingsUpdate["collaborationMode"]> {
  return appServerCollaborationMode(mode, model, reasoningEffort);
}
