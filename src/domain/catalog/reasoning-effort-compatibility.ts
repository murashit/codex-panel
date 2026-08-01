import {
  findModelMetadataByIdOrName,
  type ModelMetadata,
  normalizeReasoningEffort,
  type ReasoningEffort,
  supportedEffortsForModelMetadata,
} from "./metadata";

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

export type ReasoningEffortNormalization =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly effort: ReasoningEffort | null };

export function reasoningEffortNormalizationForModel(
  models: readonly ModelMetadata[],
  model: string | null,
  currentEffort: ReasoningEffort | null,
): ReasoningEffortNormalization {
  if (!currentEffort) return { kind: "unchanged" };
  const metadata = findModelMetadataByIdOrName(models, model);
  if (!metadata) return { kind: "unchanged" };
  const supportedEfforts = supportedEffortsForModelMetadata(metadata);
  if (supportedEfforts.includes(currentEffort)) return { kind: "unchanged" };
  const defaultEffort = normalizeReasoningEffort(metadata.defaultReasoningEffort);
  return {
    kind: "set",
    effort: defaultEffort && supportedEfforts.includes(defaultEffort) ? defaultEffort : (supportedEfforts[0] ?? null),
  };
}
