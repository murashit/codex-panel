import type { ReasoningEffort } from "../catalog/metadata";
import type { ApprovalsReviewer, ServiceTier } from "./policy";

export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type Verbosity = "low" | "medium" | "high";

export interface RuntimeConfigSnapshot {
  readonly profile: string | null;
  readonly model: string | null;
  readonly modelProvider: string | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly reasoningSummary: ReasoningSummary | null;
  readonly verbosity: Verbosity | null;
  readonly serviceTier: ServiceTier | null;
  readonly approvalsReviewer: ApprovalsReviewer | null;
  readonly modelContextWindow: number | null;
  readonly autoCompactTokenLimit: number | null;
}

export function emptyRuntimeConfigSnapshot(): RuntimeConfigSnapshot {
  return {
    profile: null,
    model: null,
    modelProvider: null,
    reasoningEffort: null,
    reasoningSummary: null,
    verbosity: null,
    serviceTier: null,
    approvalsReviewer: null,
    modelContextWindow: null,
    autoCompactTokenLimit: null,
  };
}

export function cloneRuntimeConfigSnapshot(config: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  return { ...config };
}

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigSnapshot {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}
