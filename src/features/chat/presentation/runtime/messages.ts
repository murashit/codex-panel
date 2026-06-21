import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { CollaborationModeSelection } from "../../domain/runtime/intent";

export function compactReasoningEffortLabel(effort: ReasoningEffort | null): string {
  if (!effort) return "default";
  if (effort === "minimal") return "min";
  return effort;
}

export function collaborationModeLabel(mode: CollaborationModeSelection): string {
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
