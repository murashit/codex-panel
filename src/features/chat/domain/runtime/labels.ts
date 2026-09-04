import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { CollaborationModeSelection } from "./intent";

export function compactReasoningEffortLabel(effort: ReasoningEffort): string {
  return effort === "minimal" ? "min" : effort;
}

export function collaborationModeLabel(mode: CollaborationModeSelection): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function modelOverrideMessage(model: string | null): string {
  return model === null ? "Model reset to default for subsequent turns." : `Model set to ${model} for subsequent turns.`;
}

export function reasoningEffortOverrideMessage(effort: ReasoningEffort | null): string {
  return effort === null
    ? "Reasoning effort reset to default for subsequent turns."
    : `Reasoning effort set to ${effort} for subsequent turns.`;
}

export function permissionProfileOverrideMessage(permissionProfile: string | null): string {
  return permissionProfile === null
    ? "Permission profile reset to default for subsequent turns."
    : `Permission profile set to ${permissionProfile} for subsequent turns.`;
}

export function pendingRuntimeSettingLabel(
  setting: { kind: "unchanged" } | { kind: "set"; value: string | null } | { kind: "resetToConfig" },
): string {
  if (setting.kind === "set") return setting.value ?? "(Codex default)";
  if (setting.kind === "resetToConfig") return "(reset to config)";
  return "(none)";
}

export function serviceTierLabel(value: string | null): string {
  return value ?? "(Codex default)";
}
