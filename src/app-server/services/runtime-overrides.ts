import type { RuntimeOverride, RuntimeOverrideSettings } from "../../domain/runtime/overrides";
import { runtimeOverride, validatedRuntimeOverrideForModelMetadata } from "../../domain/runtime/overrides";
import { listModelMetadata, type ModelMetadataClient } from "../catalog";

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
