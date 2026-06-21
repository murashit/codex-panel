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

type TurnCollaborationModeWarning = "missing-model";

type TurnCollaborationModeSettings =
  | {
      collaborationMode: NonNullable<RuntimeSettingsPatch["collaborationMode"]>;
      warning: null;
    }
  | {
      collaborationMode: null;
      warning: TurnCollaborationModeWarning;
    };

type RuntimeServiceTierTransportIntent =
  | { readonly kind: "omit" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly value: string };

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeServiceTierRequest {
  return serviceTierRequestValue(serviceTierTransportIntent(snapshot, config, "thread-start"));
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
    applyRuntimeSettingsPatchValue(update, "model", runtimeSettingsPatchValueFromPendingSetting(snapshot.requestedModel));
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(update, "effort", runtimeSettingsPatchValueFromPendingSetting(snapshot.requestedReasoningEffort));
  }
  applyRuntimeSettingsPatchValue(
    update,
    "serviceTier",
    serviceTierRequestValue(serviceTierTransportIntent(snapshot, config, "thread-update")),
  );
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "approvalsReviewer",
      runtimeSettingsPatchValueFromPendingSetting(snapshot.requestedApprovalsReviewer),
    );
  }
  if (snapshot.selectedCollaborationMode !== effectiveCollaborationMode(snapshot.activeCollaborationMode)) {
    if (runtimeCollaborationModeSettings.warning) {
      return { update, collaborationModeWarning: runtimeCollaborationModeSettings.warning };
    }
    applyRuntimeSettingsPatchValue(update, "collaborationMode", runtimeCollaborationModeSettings.collaborationMode);
  }
  return { update, collaborationModeWarning: null };
}

function runtimeSettingsPatchValueFromPendingSetting<T>(setting: PendingRuntimeSetting<T>): T | null | undefined {
  if (setting.kind === "set") return setting.value;
  if (setting.kind === "resetToConfig") return null;
  return undefined;
}

function serviceTierTransportIntent(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
  target: "thread-start" | "thread-update",
): RuntimeServiceTierTransportIntent {
  // app-server has no separate "reset to config" token for service tiers.
  // At the transport boundary, null is the explicit clear/off request; undefined omits the field.
  if (snapshot.requestedFastMode.kind === "set") {
    return snapshot.requestedFastMode.value === "enabled"
      ? { kind: "set", value: fastRuntimeServiceTierRequestValue(snapshot, config) }
      : { kind: "clear" };
  }
  if (snapshot.requestedFastMode.kind === "resetToConfig") return { kind: "clear" };
  if (target === "thread-start" && config.serviceTier) return { kind: "set", value: config.serviceTier };
  return { kind: "omit" };
}

function serviceTierRequestValue(intent: RuntimeServiceTierTransportIntent): RuntimeServiceTierRequest {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "clear") return null;
  return undefined;
}
