import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { CollaborationMode } from "../../domain/runtime/pending-settings";
import type { TurnCollaborationModeWarning } from "../../domain/runtime/warnings";

const COLLABORATION_MODE_WARNING_MESSAGES: Record<TurnCollaborationModeWarning, string> = {
  "missing-model": "No effective model is available. Sending without a mode override.",
};

export function modelOverrideMessage(model: string | null): string {
  return model === null ? "Model reset to default for subsequent turns." : `Model set to ${model} for subsequent turns.`;
}

export function reasoningEffortOverrideMessage(effort: ReasoningEffort | null): string {
  return effort === null
    ? "Reasoning effort reset to default for subsequent turns."
    : `Reasoning effort set to ${effort} for subsequent turns.`;
}

export function fastModeToggleMessage(state: "enabled" | "disabled"): string {
  return state === "enabled" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.";
}

export function collaborationModeToggleMessage(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.";
}

export function autoReviewToggleMessage(state: "enabled" | "disabled"): string {
  return state === "enabled" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.";
}

export function collaborationModeWarningMessage(warning: TurnCollaborationModeWarning): string {
  return COLLABORATION_MODE_WARNING_MESSAGES[warning];
}
