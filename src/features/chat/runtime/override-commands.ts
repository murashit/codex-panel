import { isReasoningEffort, type ReasoningEffort } from "../../../domain/catalog/reasoning-effort";
export { collaborationModeLabel, collaborationModeToggleMessage, nextCollaborationMode } from "./collaboration";

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
