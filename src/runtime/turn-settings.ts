import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ThreadSettingsUpdateParams } from "../generated/app-server/v2/ThreadSettingsUpdateParams";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";
import {
  currentModel,
  currentReasoningEffort,
  fastServiceTierRequestValue,
  pendingRuntimeSettingPayload,
  type RuntimeSnapshot,
} from "./effective-settings";
import { requestedServiceTierRequestValue } from "./service-tier";

export type ThreadSettingsUpdate = Omit<ThreadSettingsUpdateParams, "threadId">;
export type TurnCollaborationModeWarning = "missing-model";

export interface TurnCollaborationModeSettings {
  collaborationMode: CollaborationMode | null;
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
    const model = pendingRuntimeSettingPayload(snapshot.requestedModel);
    if (model !== undefined) update.model = model;
  }
  if (snapshot.requestedReasoningEffort.kind !== "unchanged") {
    const effort = pendingRuntimeSettingPayload(snapshot.requestedReasoningEffort);
    if (effort !== undefined) update.effort = effort;
  }
  if (snapshot.requestedServiceTier.kind === "set") {
    const serviceTier = requestedServiceTierRequestValue(
      snapshot.requestedServiceTier.value,
      fastServiceTierRequestValue(snapshot, config),
    );
    if (serviceTier !== undefined) update.serviceTier = serviceTier;
  } else if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    update.serviceTier = null;
  }
  if (snapshot.requestedApprovalsReviewer.kind !== "unchanged") {
    const approvalsReviewer = pendingRuntimeSettingPayload(snapshot.requestedApprovalsReviewer);
    if (approvalsReviewer !== undefined) update.approvalsReviewer = approvalsReviewer;
  }
  if (snapshot.selectedCollaborationMode !== snapshot.activeCollaborationMode) {
    if (collaborationModeSettings.warning) {
      return { update, collaborationModeWarning: collaborationModeSettings.warning };
    }
    if (collaborationModeSettings.collaborationMode) update.collaborationMode = collaborationModeSettings.collaborationMode;
  }
  return { update, collaborationModeWarning: null };
}

function collaborationModePayload(
  mode: RuntimeSnapshot["selectedCollaborationMode"],
  model: string,
  reasoningEffort: ReturnType<typeof currentReasoningEffort>,
): CollaborationMode {
  return {
    mode,
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}
