import type { RuntimeOverride, RuntimeOverrideSettings } from "../../domain/runtime/overrides";
import { runtimeOverride, validatedRuntimeOverrideForModelMetadata } from "../../domain/runtime/overrides";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import { listModelMetadata } from "../catalog/data";

interface RuntimeOverrideModelClient {
  listModels(includeHidden: boolean): Promise<ModelListResponse>;
}

export async function resolvedRuntimeOverrideForClient(
  client: RuntimeOverrideModelClient,
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
