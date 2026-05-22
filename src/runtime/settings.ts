import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import { isReasoningEffort } from "./model";

const DEFAULT_ALIASES = new Set(["default", "reset", "clear", "off"]);

export function parseModelOverride(args: string): string | null | undefined {
  const model = args.trim();
  if (!model) return undefined;
  if (DEFAULT_ALIASES.has(model.toLowerCase())) return null;
  return model;
}

export function parseReasoningEffortOverride(args: string): ReasoningEffort | null | undefined {
  const effort = args.trim().toLowerCase();
  if (!effort) return undefined;
  if (DEFAULT_ALIASES.has(effort)) return null;
  return isReasoningEffort(effort) ? effort : undefined;
}

export function modelOverrideMessage(model: string | null): string {
  return model === null ? "Model reset to default for subsequent turns." : `Model set to ${model} for subsequent turns.`;
}

export function reasoningEffortOverrideMessage(effort: ReasoningEffort | null): string {
  return effort === null ? "Effort reset to default for subsequent turns." : `Effort set to ${effort} for subsequent turns.`;
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

export function compactContextLabel(percent: number | null, label: string): string {
  if (percent !== null) return `${String(percent)}%`;
  if (label === "Context unknown") return "?";
  return label === "Context waiting" ? "wait" : label.replace(/^Context\s+/i, "");
}
