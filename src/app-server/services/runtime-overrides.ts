import type { ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../domain/catalog/metadata";
import { listModelMetadata, type ModelMetadataClient } from "../catalog";

export interface RuntimeOverrideSettings {
  model: string | null;
  effort: ReasoningEffort | null;
}

export interface RuntimeOverride {
  model?: string;
  effort?: ReasoningEffort;
}

export async function resolvedRuntimeOverrideForClient(
  client: ModelMetadataClient,
  settings: RuntimeOverrideSettings,
): Promise<RuntimeOverride> {
  const runtime = runtimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    return validatedRuntimeOverrideForModelMetadata(settings, await listModelMetadata(client));
  } catch {
    return runtime;
  }
}

function runtimeOverride(settings: RuntimeOverrideSettings): RuntimeOverride {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  };
}

function validatedRuntimeOverrideForModelMetadata(settings: RuntimeOverrideSettings, models: readonly ModelMetadata[]): RuntimeOverride {
  const runtime = runtimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;

  const model = findModelMetadataByIdOrName(models, runtime.model);
  if (!model) return runtime;

  const supportedEfforts = new Set(supportedEffortsForModelMetadata(model));
  return supportedEfforts.has(runtime.effort) ? runtime : { model: runtime.model };
}
