import type { ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { unsupportedReasoningEffort, unsupportedReasoningEffortMessage } from "../../domain/catalog/reasoning-effort-compatibility";
import { listModelMetadata, type ModelMetadataClient } from "./catalog";

export interface RuntimeOverrideSettings {
  readonly model: string | null;
  readonly effort: ReasoningEffort | null;
}

export interface RuntimeOverride {
  readonly model?: string;
  readonly effort?: ReasoningEffort;
}

export async function validatedRuntimeOverrideForClient(
  client: ModelMetadataClient,
  settings: RuntimeOverrideSettings,
): Promise<RuntimeOverride> {
  const runtime = runtimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;

  let models: ModelMetadata[];
  try {
    models = await listModelMetadata(client);
  } catch {
    return runtime;
  }
  const unsupported = unsupportedReasoningEffort(models, runtime.model, runtime.effort);
  if (unsupported) throw new Error(unsupportedReasoningEffortMessage(unsupported));
  return runtime;
}

function runtimeOverride(settings: RuntimeOverrideSettings): RuntimeOverride {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  };
}
