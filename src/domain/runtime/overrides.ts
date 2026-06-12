import type { ModelMetadata, ReasoningEffort } from "../catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../catalog/metadata";

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

export function validatedRuntimeOverrideForModelMetadata(
  settings: RuntimeOverrideSettings,
  models: readonly ModelMetadata[],
): RuntimeOverride {
  const runtime = runtimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;

  const model = findModelMetadataByIdOrName(models, runtime.model);
  if (!model) return runtime;

  const supportedEfforts = new Set(supportedEffortsForModelMetadata(model));
  return supportedEfforts.has(runtime.effort) ? runtime : { model: runtime.model };
}
