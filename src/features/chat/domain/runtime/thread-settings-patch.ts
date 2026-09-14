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

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  collaborationModeWarning: TurnCollaborationModeWarning | null;
}

export function serviceTierRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeServiceTierRequest {
  return serviceTierRequest(snapshot, resolveRuntimeControls(snapshot, config), "thread-start");
}

export function permissionProfileRequestForThreadStart(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | undefined {
  if (snapshot.pending.permissionProfile.kind === "set") return snapshot.pending.permissionProfile.value;
  return config.startupPermissions.activePermissionProfile?.id ?? undefined;
}

export function pendingRuntimeSettingsPatch(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): PendingRuntimeSettingsPatch {
  const update: RuntimeSettingsPatch = {};
  const resolution = resolveRuntimeControls(snapshot, config);
  const pending = snapshot.pending;

  applyRuntimeSettingsPatchValue(update, "model", pendingRuntimeRequestValue(pending.model));
  applyRuntimeSettingsPatchValue(update, "effort", pendingRuntimeRequestValue(pending.reasoningEffort));
  applyRuntimeSettingsPatchValue(update, "serviceTier", serviceTierRequest(snapshot, resolution, "thread-update"));
  applyRuntimeSettingsPatchValue(update, "approvalPolicy", pendingRuntimeRequestValue(pending.approvalPolicy));
  applyRuntimeSettingsPatchValue(update, "permissions", pendingRuntimeRequestValue(pending.permissionProfile));
  applyRuntimeSettingsPatchValue(update, "approvalsReviewer", pendingRuntimeRequestValue(pending.approvalsReviewer));
  if (resolution.collaborationMode.dirty) {
    const requestedMode = requestedTurnCollaborationModeSettings(resolution);
    if (requestedMode.warning) {
      return { update, collaborationModeWarning: requestedMode.warning };
    }
    applyRuntimeSettingsPatchValue(update, "collaborationMode", requestedMode.collaborationMode);
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

function pendingRuntimeRequestValue<T>(intent: PendingRuntimeIntent<T>): T | null | undefined {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "resetToConfig") return null;
  return undefined;
}

function serviceTierRequest(
  snapshot: RuntimeSnapshot,
  resolution: RuntimeControlsResolution,
  target: "thread-start" | "thread-update",
): RuntimeServiceTierRequest {
  // app-server has no separate "reset to config" token for service tiers.
  // thread/start null falls back to app-server's baseline/default tier, so a reset
  // to configured service_tier must send the configured id explicitly.
  if (snapshot.pending.fastMode.kind === "set") {
    if (snapshot.pending.fastMode.value === "disabled") return null;
    return resolution.fastMode.serviceTierRequestValue || undefined;
  }
  if (snapshot.pending.fastMode.kind === "resetToConfig") {
    if (target === "thread-start") {
      return resolution.serviceTier.configured || undefined;
    }
    return null;
  }
  if (target === "thread-start" && resolution.serviceTier.configured) {
    return resolution.serviceTier.configured;
  }
  return undefined;
}
