import { applyThreadSettingsValue, appServerCollaborationMode, type ThreadSettingsUpdate } from "../../../app-server/thread-settings";
import type { ServiceTierRequest } from "../../../app-server/thread-settings";
import { currentModel, currentReasoningEffort, fastServiceTierRequestValue } from "./effective";
import type { RuntimeConfigSnapshot } from "../../../app-server/runtime-config";
import type { RuntimeSnapshot } from "./snapshot";
import type { PendingRuntimeSetting } from "./pending-settings";

export type TurnCollaborationModeWarning = "missing-model";

export type TurnCollaborationModeSettings =
  | {
      collaborationMode: NonNullable<ThreadSettingsUpdate["collaborationMode"]>;
      warning: null;
    }
  | {
      collaborationMode: null;
      warning: TurnCollaborationModeWarning;
    };

export interface PendingThreadSettingsUpdate {
  update: ThreadSettingsUpdate;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ServiceTierRequest {
  if (snapshot.requestedServiceTier.kind === "set") {
    return snapshot.requestedServiceTier.value === "fast" ? fastServiceTierRequestValue(snapshot, config) : null;
  }
  if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    return null;
  }
  return config.serviceTier ?? undefined;
}

export function requestedTurnCollaborationModeSettings(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
): TurnCollaborationModeSettings {
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  if (!model) return { collaborationMode: null, warning: "missing-model" };
  return {
    collaborationMode: appServerCollaborationMode(snapshot.selectedCollaborationMode, model, effort),
    warning: null,
  };
}

export function pendingThreadSettingsUpdate(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): PendingThreadSettingsUpdate {
  const update: ThreadSettingsUpdate = {};
  const collaborationModeSettings = requestedTurnCollaborationModeSettings(snapshot, config);

  if (snapshot.requestedModel.kind !== "unchanged") {
    applyThreadSettingsValue(update, "model", appServerThreadSettingsValue(snapshot.requestedModel));
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    applyThreadSettingsValue(update, "effort", appServerThreadSettingsValue(snapshot.requestedReasoningEffort));
  }
  if (snapshot.requestedServiceTier.kind === "set") {
    applyThreadSettingsValue(
      update,
      "serviceTier",
      snapshot.requestedServiceTier.value === "fast" ? fastServiceTierRequestValue(snapshot, config) : null,
    );
  } else if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    applyThreadSettingsValue(update, "serviceTier", null);
  }
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    applyThreadSettingsValue(update, "approvalsReviewer", appServerThreadSettingsValue(snapshot.requestedApprovalsReviewer));
  }
  if (snapshot.selectedCollaborationMode !== snapshot.activeCollaborationMode) {
    if (collaborationModeSettings.warning) {
      return { update, collaborationModeWarning: collaborationModeSettings.warning };
    }
    applyThreadSettingsValue(update, "collaborationMode", collaborationModeSettings.collaborationMode);
  }
  return { update, collaborationModeWarning: null };
}

function appServerThreadSettingsValue<T>(setting: PendingRuntimeSetting<T>): T | null | undefined {
  if (setting.kind === "set") return setting.value;
  if (setting.kind === "resetToConfig") return null;
  return undefined;
}
