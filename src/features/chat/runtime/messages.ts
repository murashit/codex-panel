import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { CollaborationMode } from "./pending-settings";
import type { TurnCollaborationModeWarning } from "./thread-settings-update";

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

export function compactModelLabel(model: string | null): string {
  if (!model) return "default";
  const match = /^gpt-(.+)$/.exec(model);
  return match?.[1] ?? model;
}

export function compactReasoningEffortLabel(effort: ReasoningEffort | null): string {
  if (!effort) return "default";
  if (effort === "minimal") return "min";
  return effort;
}

export function collaborationModeLabel(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function pendingRuntimeSettingLabel(
  setting: { kind: "unchanged" } | { kind: "set"; value: unknown } | { kind: "resetToConfig" },
): string {
  if (setting.kind === "set") return String(setting.value);
  if (setting.kind === "resetToConfig") return "(reset to config)";
  return "(none)";
}

export function serviceTierLabel(value: string | null): string {
  return value ?? "(Codex default)";
}

export function fastModeLabel(input: { requestedOff: boolean; active: boolean; serviceTier: string | null }): string {
  if (input.requestedOff) return "off";
  if (input.active) return "on";
  return input.serviceTier ? "off" : "Codex default";
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
