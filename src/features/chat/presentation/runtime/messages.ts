import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { CollaborationMode } from "../../domain/runtime/pending-settings";

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
