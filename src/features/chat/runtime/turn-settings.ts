import { applyThreadSettingsValue, appServerCollaborationMode, type ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";
import {
  currentModel,
  currentReasoningEffort,
  fastServiceTierRequestValue,
  pendingRuntimeSettingPayload,
  type RuntimeSnapshot,
} from "./effective-settings";
import { clearedServiceTierRequestValue, serviceTierRequestValue } from "../../../app-server/thread-settings";

export type TurnCollaborationModeWarning = "missing-model";

export interface TurnCollaborationModeSettings {
  collaborationMode: ThreadSettingsUpdate["collaborationMode"] | null;
  warning: TurnCollaborationModeWarning | null;
}

export interface PendingThreadSettingsUpdate {
  update: ThreadSettingsUpdate;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
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
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
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
