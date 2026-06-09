import type { PanelModelOption } from "./model";

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
