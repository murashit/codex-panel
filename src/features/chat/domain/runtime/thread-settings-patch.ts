import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import {
  applyRuntimeSettingsPatchValue,
  type RuntimeServiceTierRequest,
  type RuntimeSettingsPatch,
  runtimeCollaborationModeSettings,
} from "../../../../domain/runtime/thread-settings";
import type { PendingRuntimeIntent } from "./intent";
import { type RuntimeControlsResolution, resolveRuntimeControls } from "./resolution";
import type { RuntimeSnapshot } from "./snapshot";

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

// Patch intent is the runtime settings request vocabulary:
// omit -> leave the field out, clear -> send null, set -> send a concrete value.
// For service tiers, app-server treats null as clearing to its baseline/default tier,
// not as "use the configured service_tier" for thread/start.
type RuntimeSettingsPatchIntent<T> = { readonly kind: "omit" } | { readonly kind: "clear" } | { readonly kind: "set"; readonly value: T };

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeServiceTierRequest {
  return runtimeSettingsPatchValue(serviceTierPatchIntent(snapshot, resolveRuntimeControls(snapshot, config), "thread-start"));
}

export function permissionProfileRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | undefined {
  if (snapshot.pending.permissionProfile.kind === "set") return snapshot.pending.permissionProfile.value;
  return config.startupPermissions.activePermissionProfile?.id ?? undefined;
}

export function pendingRuntimeSettingsPatch(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): PendingRuntimeSettingsPatch {
  const update: RuntimeSettingsPatch = {};
  const resolution = resolveRuntimeControls(snapshot, config);
  const runtimeCollaborationModeSettings = requestedTurnCollaborationModeSettings(resolution);

  if (snapshot.pending.model.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "model",
      runtimeSettingsPatchValue(runtimeSettingsPatchIntentFromPending(snapshot.pending.model)),
    );
  }
  if (snapshot.pending.reasoningEffort.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "effort",
      runtimeSettingsPatchValue(runtimeSettingsPatchIntentFromPending(snapshot.pending.reasoningEffort)),
    );
  }
  applyRuntimeSettingsPatchValue(
    update,
    "serviceTier",
    runtimeSettingsPatchValue(serviceTierPatchIntent(snapshot, resolution, "thread-update")),
  );
  if (snapshot.pending.approvalPolicy.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "approvalPolicy",
      runtimeSettingsPatchValue(runtimeSettingsPatchIntentFromPending(snapshot.pending.approvalPolicy)),
    );
  }
  if (snapshot.pending.permissionProfile.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "permissions",
      runtimeSettingsPatchValue(runtimeSettingsPatchIntentFromPending(snapshot.pending.permissionProfile)),
    );
  }
  if (snapshot.pending.approvalsReviewer.kind !== "unchanged") {
    applyRuntimeSettingsPatchValue(
      update,
      "approvalsReviewer",
      runtimeSettingsPatchValue(runtimeSettingsPatchIntentFromPending(snapshot.pending.approvalsReviewer)),
    );
  }
  if (resolution.collaborationMode.dirty) {
    if (runtimeCollaborationModeSettings.warning) {
      return { update, collaborationModeWarning: runtimeCollaborationModeSettings.warning };
    }
    applyRuntimeSettingsPatchValue(update, "collaborationMode", runtimeCollaborationModeSettings.collaborationMode);
  }
  return { update, collaborationModeWarning: null };
}

function requestedTurnCollaborationModeSettings(resolution: RuntimeControlsResolution): TurnCollaborationModeSettings {
  const model = resolution.model.effective;
  const effort = resolution.reasoningEffort.effective;
  if (!model) return { collaborationMode: null, warning: "missing-model" };
  return {
    collaborationMode: runtimeCollaborationModeSettings(resolution.collaborationMode.effective, model, effort),
    warning: null,
  };
}

function runtimeSettingsPatchIntentFromPending<T>(intent: PendingRuntimeIntent<T>): RuntimeSettingsPatchIntent<T> {
  if (intent.kind === "set") return { kind: "set", value: intent.value };
  if (intent.kind === "resetToConfig") return { kind: "clear" };
  return { kind: "omit" };
}

function serviceTierPatchIntent(
  snapshot: RuntimeSnapshot,
  resolution: RuntimeControlsResolution,
  target: "thread-start" | "thread-update",
): RuntimeSettingsPatchIntent<string> {
  // app-server has no separate "reset to config" token for service tiers.
  // thread/start null falls back to app-server's baseline/default tier, so a reset
  // to configured service_tier must send the configured id explicitly.
  if (snapshot.pending.fastMode.kind === "set") {
    return snapshot.pending.fastMode.value === "enabled"
      ? { kind: "set", value: resolution.fastMode.serviceTierRequestValue }
      : { kind: "clear" };
  }
  if (snapshot.pending.fastMode.kind === "resetToConfig") {
    if (target === "thread-start") {
      return resolution.serviceTier.configured ? { kind: "set", value: resolution.serviceTier.configured } : { kind: "omit" };
    }
    return { kind: "clear" };
  }
  if (target === "thread-start" && resolution.serviceTier.configured) {
    return { kind: "set", value: resolution.serviceTier.configured };
  }
  return { kind: "omit" };
}

function runtimeSettingsPatchValue<T>(intent: RuntimeSettingsPatchIntent<T>): T | null | undefined {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "clear") return null;
  return undefined;
}
