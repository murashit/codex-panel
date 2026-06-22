import type { ReasoningEffort } from "../catalog/metadata";
import type { ApprovalsReviewer } from "./policy";

export type RuntimeServiceTierRequest = string | null | undefined;
export type ModeKind = "plan" | "default";

export interface CollaborationMode {
  mode: ModeKind;
  settings: {
    model: string;
    reasoningEffort: ReasoningEffort | null;
    developerInstructions: string | null;
  };
}

export interface RuntimeSettingsPatch {
  cwd?: string | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  collaborationMode?: CollaborationMode | null;
}

export function applyRuntimeSettingsPatchValue<K extends keyof RuntimeSettingsPatch>(
  update: RuntimeSettingsPatch,
  key: K,
  value: RuntimeSettingsPatch[K] | undefined,
): void {
  if (value !== undefined) update[key] = value;
}

export function runtimeCollaborationModeSettings(
  mode: ModeKind,
  model: string,
  reasoningEffort: ReasoningEffort | null,
): CollaborationMode {
  return {
    mode,
    settings: {
      model,
      reasoningEffort,
      developerInstructions: null,
    },
  };
}
