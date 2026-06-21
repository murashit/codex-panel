import {
  applyRuntimeSettingsPatchValue,
  runtimeCollaborationModeSettings,
  type RuntimeServiceTierRequest,
  type RuntimeSettingsPatch,
} from "../../../../domain/runtime/thread-settings";
import { currentModel, currentReasoningEffort, fastRuntimeServiceTierRequestValue } from "../../domain/runtime/effective";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { effectiveCollaborationMode, type PendingRuntimeIntent } from "../../domain/runtime/intent";

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

// Transport intent is the app-server boundary vocabulary:
// omit -> leave the field out, clear -> send null, set -> send a concrete value.
type RuntimeTransportIntent<T> = { readonly kind: "omit" } | { readonly kind: "clear" } | { readonly kind: "set"; readonly value: T };

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeServiceTierRequest {
  return runtimeSettingsPatchValue(serviceTierTransportIntent(snapshot, config, "thread-start"));
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
    applyRuntimeSettingsPatchValue(update, "model", runtimeSettingsPatchValue(runtimeTransportIntentFromPending(snapshot.requestedModel)));
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "effort",
      runtimeSettingsPatchValue(runtimeTransportIntentFromPending(snapshot.requestedReasoningEffort)),
    );
  }
  applyRuntimeSettingsPatchValue(
    update,
    "serviceTier",
    runtimeSettingsPatchValue(serviceTierTransportIntent(snapshot, config, "thread-update")),
  );
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "approvalsReviewer",
      runtimeSettingsPatchValue(runtimeTransportIntentFromPending(snapshot.requestedApprovalsReviewer)),
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

function runtimeTransportIntentFromPending<T>(intent: PendingRuntimeIntent<T>): RuntimeTransportIntent<T> {
  if (intent.kind === "set") return { kind: "set", value: intent.value };
  if (intent.kind === "resetToConfig") return { kind: "clear" };
  return { kind: "omit" };
}

function serviceTierTransportIntent(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
  target: "thread-start" | "thread-update",
): RuntimeTransportIntent<string> {
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

function runtimeSettingsPatchValue<T>(intent: RuntimeTransportIntent<T>): T | null | undefined {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "clear") return null;
  return undefined;
}
