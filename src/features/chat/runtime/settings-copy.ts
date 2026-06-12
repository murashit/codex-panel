import type { ReasoningEffort } from "../../../domain/catalog/metadata";

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
