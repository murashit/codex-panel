import type { PanelModelOption } from "../domain/catalog/metadata";
import { findModelOptionByIdOrName } from "../domain/catalog/metadata";
import type { ReasoningEffort as AppServerReasoningEffort } from "../generated/app-server/ReasoningEffort";
import { supportedEffortsForModelOption, type ReasoningEffort as DomainReasoningEffort } from "../domain/catalog/metadata";

export interface RuntimeOverrideSettings {
  model: string | null;
  effort: DomainReasoningEffort | null;
}

export interface RuntimeOverride {
  model?: string;
  effort?: AppServerReasoningEffort;
}

export function runtimeOverride(settings: RuntimeOverrideSettings): RuntimeOverride {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: appServerReasoningEffort(settings.effort) } : {}),
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

function appServerReasoningEffort(effort: DomainReasoningEffort): AppServerReasoningEffort {
  return effort;
}
