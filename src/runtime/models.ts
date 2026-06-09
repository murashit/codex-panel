import type { ReasoningEffort as AppServerReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { PanelModelOption } from "../domain/catalog/model";
export { findModelOptionByIdOrName, sortedModelOptions } from "../domain/catalog/model";
import { findModelOptionByIdOrName } from "../domain/catalog/model";

export type ReasoningEffort = AppServerReasoningEffort;

export const REASONING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as string[]).includes(value);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

export function supportedEffortsForModelOption(model: PanelModelOption | null): ReasoningEffort[] {
  const efforts = model?.supportedReasoningEfforts.filter(isReasoningEffort) ?? [];
  return efforts.length > 0 ? efforts : REASONING_EFFORTS;
}

export function defaultEffortForModelOption(model: PanelModelOption | null): ReasoningEffort | null {
  return normalizeReasoningEffort(model?.defaultReasoningEffort);
}

export interface RuntimeOverrideSettings {
  model: string | null;
  effort: ReasoningEffort | null;
}

export interface RuntimeOverride {
  model?: string;
  effort?: ReasoningEffort;
}

export function runtimeOverride(settings: RuntimeOverrideSettings): RuntimeOverride {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  };
}

export function validatedRuntimeOverrideForModelOptions(
  settings: RuntimeOverrideSettings,
  models: readonly PanelModelOption[],
): RuntimeOverride {
  const runtime = runtimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;

  const model = findModelOptionByIdOrName(models, runtime.model);
  if (!model) return runtime;

  const supportedEfforts = new Set(supportedEffortsForModelOption(model));
  return supportedEfforts.has(runtime.effort) ? runtime : { model: runtime.model };
}
