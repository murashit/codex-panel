import type { PanelModelOption, ReasoningEffort } from "./metadata";
import { findModelOptionByIdOrName, supportedEffortsForModelOption } from "./metadata";

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
