import {
  applyRuntimeSettingsPatchValue,
  runtimeCollaborationModeSettings,
  type RuntimeServiceTierRequest,
  type RuntimeSettingsPatch,
} from "../../../../domain/runtime/thread-settings";
import { currentModel, currentReasoningEffort, fastRuntimeServiceTierRequestValue } from "../../domain/runtime/effective";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { effectiveCollaborationMode, type PendingRuntimeSetting } from "../../domain/runtime/pending-settings";

export type TurnCollaborationModeWarning = "missing-model";

type TurnCollaborationModeSettings =
  | {
      collaborationMode: NonNullable<RuntimeSettingsPatch["collaborationMode"]>;
      warning: null;
    }
  | {
      collaborationMode: null;
      warning: TurnCollaborationModeWarning;
    };

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeServiceTierRequest {
  if (snapshot.requestedServiceTier.kind === "set") {
    return snapshot.requestedServiceTier.value === "fast" ? fastRuntimeServiceTierRequestValue(snapshot, config) : null;
  }
  if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    return null;
  }
  return config.serviceTier ?? undefined;
}

function requestedTurnCollaborationModeSettings(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): TurnCollaborationModeSettings {
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  if (!model) return { collaborationMode: null, warning: "missing-model" };
  return {
    collaborationMode: runtimeCollaborationModeSettings(snapshot.selectedCollaborationMode, model, effort),
    warning: null,
  };
}

export function pendingRuntimeSettingsPatch(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): PendingRuntimeSettingsPatch {
  const update: RuntimeSettingsPatch = {};
  const runtimeCollaborationModeSettings = requestedTurnCollaborationModeSettings(snapshot, config);

  if (snapshot.requestedModel.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(update, "model", runtimeSettingsPatchValue(snapshot.requestedModel));
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(update, "effort", runtimeSettingsPatchValue(snapshot.requestedReasoningEffort));
  }
  if (snapshot.requestedServiceTier.kind === "set") {
    applyRuntimeSettingsPatchValue(
      update,
      "serviceTier",
      snapshot.requestedServiceTier.value === "fast" ? fastRuntimeServiceTierRequestValue(snapshot, config) : null,
    );
  } else if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    applyRuntimeSettingsPatchValue(update, "serviceTier", null);
  }
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(update, "approvalsReviewer", runtimeSettingsPatchValue(snapshot.requestedApprovalsReviewer));
  }
  if (snapshot.selectedCollaborationMode !== effectiveCollaborationMode(snapshot.activeCollaborationMode)) {
    if (runtimeCollaborationModeSettings.warning) {
      return { update, collaborationModeWarning: runtimeCollaborationModeSettings.warning };
    }
    applyRuntimeSettingsPatchValue(update, "collaborationMode", runtimeCollaborationModeSettings.collaborationMode);
  }
  return { update, collaborationModeWarning: null };
}

function runtimeSettingsPatchValue<T>(setting: PendingRuntimeSetting<T>): T | null | undefined {
  if (setting.kind === "set") return setting.value;
  if (setting.kind === "resetToConfig") return null;
  return undefined;
}
