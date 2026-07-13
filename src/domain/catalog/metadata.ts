interface ModelServiceTier {
  readonly id: string;
  readonly name: string;
}

interface ReasoningEffortMetadata {
  readonly reasoningEffort: string;
  readonly description: string;
}

export interface ModelMetadata {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly supportedReasoningEfforts: readonly string[];
  readonly reasoningEffortOptions?: readonly ReasoningEffortMetadata[];
  readonly defaultReasoningEffort: string | null;
  readonly inputModalities: readonly string[];
  readonly serviceTiers: readonly ModelServiceTier[];
  readonly defaultServiceTier: string | null;
  readonly isDefault: boolean;
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly shortDescription?: string;
  readonly interfaceShortDescription?: string;
  readonly path: string;
  readonly enabled: boolean;
}

type HookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export interface HookItem {
  readonly key: string;
  readonly eventName: string;
  readonly matcher: string | null;
  readonly command: string | null;
  readonly statusMessage: string | null;
  readonly sourcePath: string;
  readonly enabled: boolean;
  readonly isManaged: boolean;
  readonly currentHash: string;
  readonly trustStatus: HookTrustStatus;
}

export type ReasoningEffort = string;

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function supportedEffortsForModelMetadata(model: ModelMetadata | null): ReasoningEffort[] {
  return (
    model?.supportedReasoningEfforts.map(normalizeReasoningEffort).filter((effort): effort is ReasoningEffort => effort !== null) ?? []
  );
}

export function reasoningEffortDescriptionForModelMetadata(model: ModelMetadata | null, effort: ReasoningEffort): string | null {
  const normalizedEffort = normalizeReasoningEffort(effort);
  if (!normalizedEffort) return null;
  const option = model?.reasoningEffortOptions?.find((item) => normalizeReasoningEffort(item.reasoningEffort) === normalizedEffort);
  const description = option?.description.trim();
  return description ? description : null;
}

export function sortedModelMetadata(models: readonly ModelMetadata[]): ModelMetadata[] {
  return [...models]
    .filter((model) => !model.hidden)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.model.localeCompare(b.model));
}

export function findModelMetadataByIdOrName(
  models: readonly ModelMetadata[],
  modelIdOrName: string | null | undefined,
): ModelMetadata | null {
  if (!modelIdOrName) return null;
  return models.find((model) => !model.hidden && (model.model === modelIdOrName || model.id === modelIdOrName)) ?? null;
}
