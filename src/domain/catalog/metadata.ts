interface PanelModelServiceTier {
  id: string;
  name: string;
}

export interface PanelModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: readonly string[];
  defaultReasoningEffort: string | null;
  inputModalities: readonly string[];
  additionalSpeedTiers: readonly string[];
  serviceTiers: readonly PanelModelServiceTier[];
  defaultServiceTier: string | null;
  isDefault: boolean;
}

export interface PanelSkillOption {
  name: string;
  description: string;
  shortDescription?: string;
  interfaceShortDescription?: string;
  path: string;
  enabled: boolean;
}

type PanelHookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export interface PanelHookItem {
  key: string;
  eventName: string;
  matcher: string | null;
  command: string | null;
  statusMessage: string | null;
  sourcePath: string;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: PanelHookTrustStatus;
}

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

export function supportedEffortsForModelOption(model: PanelModelOption | null): ReasoningEffort[] {
  const efforts = model?.supportedReasoningEfforts.filter(isReasoningEffort) ?? [];
  return efforts.length > 0 ? efforts : [...REASONING_EFFORTS];
}

export function defaultEffortForModelOption(model: PanelModelOption | null): ReasoningEffort | null {
  return normalizeReasoningEffort(model?.defaultReasoningEffort);
}

export function sortedModelOptions(models: readonly PanelModelOption[]): PanelModelOption[] {
  return [...models]
    .filter((model) => !model.hidden)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.model.localeCompare(b.model));
}

export function findModelOptionByIdOrName(
  models: readonly PanelModelOption[],
  modelIdOrName: string | null | undefined,
): PanelModelOption | null {
  if (!modelIdOrName) return null;
  return models.find((model) => !model.hidden && (model.model === modelIdOrName || model.id === modelIdOrName)) ?? null;
}
