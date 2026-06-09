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

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

export function supportedEffortsForModelMetadata(model: ModelMetadata | null): ReasoningEffort[] {
  const efforts = model?.supportedReasoningEfforts.filter(isReasoningEffort) ?? [];
  return efforts.length > 0 ? efforts : [...REASONING_EFFORTS];
}

export function defaultEffortForModelMetadata(model: ModelMetadata | null): ReasoningEffort | null {
  return normalizeReasoningEffort(model?.defaultReasoningEffort);
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
