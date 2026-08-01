import { findModelMetadataByIdOrName, type ModelMetadata, type ReasoningEffort, supportedEffortsForModelMetadata } from "./metadata";

export interface UnsupportedReasoningEffort {
  readonly model: string;
  readonly effort: ReasoningEffort;
  readonly supportedEfforts: readonly ReasoningEffort[];
}

export function unsupportedReasoningEffort(
  models: readonly ModelMetadata[],
  model: string | null,
  effort: ReasoningEffort,
): UnsupportedReasoningEffort | null {
  const metadata = findModelMetadataByIdOrName(models, model);
  if (!metadata) return null;
  const supportedEfforts = supportedEffortsForModelMetadata(metadata);
  return supportedEfforts.includes(effort) ? null : { model: metadata.model, effort, supportedEfforts };
}

export function unsupportedReasoningEffortMessage(issue: UnsupportedReasoningEffort): string {
  const supported = issue.supportedEfforts.length > 0 ? ` Supported: ${issue.supportedEfforts.join(", ")}.` : "";
  return `Reasoning effort ${issue.effort} is unavailable for ${issue.model}.${supported}`;
}
