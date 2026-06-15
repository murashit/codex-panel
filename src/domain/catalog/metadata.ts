interface ModelServiceTier {
  id: string;
  name: string;
}

export interface ModelMetadata {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: readonly string[];
  defaultReasoningEffort: string | null;
  inputModalities: readonly string[];
  additionalSpeedTiers: readonly string[];
  serviceTiers: readonly ModelServiceTier[];
  defaultServiceTier: string | null;
  isDefault: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interfaceShortDescription?: string;
  path: string;
  enabled: boolean;
}

type HookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export interface HookItem {
  key: string;
  eventName: string;
  matcher: string | null;
  command: string | null;
  statusMessage: string | null;
  sourcePath: string;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: HookTrustStatus;
}

export type ReasoningEffort = string;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return nonEmptyString(value) ? value.trim() : null;
}

export function supportedEffortsForModelMetadata(model: ModelMetadata | null): ReasoningEffort[] {
  return (
    model?.supportedReasoningEfforts.map(normalizeReasoningEffort).filter((effort): effort is ReasoningEffort => effort !== null) ?? []
  );
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
