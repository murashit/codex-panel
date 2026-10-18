import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/settings";
import {
  type RuntimeServiceTierRequest,
  type RuntimeSettingsPatch,
  runtimeCollaborationModeSettings,
} from "../../../../domain/runtime/settings";
import type { PendingRuntimeIntent } from "./intent";
import { type RuntimeControlsResolution, resolveRuntimeControls } from "./resolution";
import type { RuntimeSnapshot } from "./snapshot";
import type { PendingRuntimeIntentState } from "./state";

type TurnCollaborationModeWarning = "missing-model";

export interface PendingRuntimeSettingsPatch {
  update: RuntimeSettingsPatch;
  intents: Partial<PendingRuntimeIntentState>;
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
  const intents: Partial<PendingRuntimeIntentState> = {};
  const resolution = resolveRuntimeControls(snapshot, config);
  const pending = snapshot.pending;

  include("model", "model", pendingRuntimeRequestValue(pending.model, config.model));
  include("reasoningEffort", "effort", pendingRuntimeRequestValue(pending.reasoningEffort, config.reasoningEffort));
  include("fastMode", "serviceTier", serviceTierRequest(snapshot, resolution, "thread-update"));
  include(
    "permissionProfile",
    "permissions",
    pendingRuntimeRequestValue(pending.permissionProfile, config.startupPermissions.activePermissionProfile?.id ?? null),
  );
  include("approvalsReviewer", "approvalsReviewer", pendingRuntimeRequestValue(pending.approvalsReviewer, config.approvalsReviewer));
  if (resolution.collaborationMode.dirty) {
    const model = resolution.model.effective;
    if (!model) return { update, intents, collaborationModeWarning: "missing-model" };
    include(
      "collaborationMode",
      "collaborationMode",
      runtimeCollaborationModeSettings(resolution.collaborationMode.effective, model, resolution.reasoningEffort.effective),
    );
  }
  return { update, intents, collaborationModeWarning: null };

  function include<K extends keyof RuntimeSettingsPatch>(
    intent: keyof PendingRuntimeIntentState,
    field: K,
    value: RuntimeSettingsPatch[K] | undefined,
  ): void {
    if (value === undefined) return;
    update[field] = value;
    Object.assign(intents, { [intent]: pending[intent] });
  }
}

function pendingRuntimeRequestValue<T>(intent: PendingRuntimeIntent<T>, configured: T | null): T | undefined {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "resetToConfig") return configured ?? undefined;
  return undefined;
}

function serviceTierRequest(
  snapshot: RuntimeSnapshot,
  resolution: RuntimeControlsResolution,
  target: "thread-start" | "thread-update",
): RuntimeServiceTierRequest {
  if (snapshot.pending.fastMode.kind === "set") {
    if (snapshot.pending.fastMode.value === "disabled") return null;
    return resolution.fastMode.serviceTierRequestValue || undefined;
  }
  if (target === "thread-start" && resolution.serviceTier.configured) {
    return resolution.serviceTier.configured;
  }
  return undefined;
}
