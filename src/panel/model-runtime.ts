import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Model } from "../generated/app-server/v2/Model";

export const REASONING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as string[]).includes(value);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

export function sortedAvailableModels(models: Model[]): Model[] {
  return [...models]
    .filter((model) => !model.hidden)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.model.localeCompare(b.model));
}

export function findModelByIdOrName(models: Model[], modelIdOrName: string | null | undefined): Model | null {
  if (!modelIdOrName) return null;
  return models.find((model) => !model.hidden && (model.model === modelIdOrName || model.id === modelIdOrName)) ?? null;
}

export function supportedEffortsForModel(model: Model | null): ReasoningEffort[] {
  const efforts = model?.supportedReasoningEfforts.map((option) => option.reasoningEffort).filter(isReasoningEffort) ?? [];
  return efforts.length > 0 ? efforts : REASONING_EFFORTS;
}
