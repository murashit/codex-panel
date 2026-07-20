import type { ReasoningEffort } from "../catalog/metadata";
import { cloneRuntimePermissionState, initialRuntimePermissionState, type RuntimePermissionState } from "./permissions";
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
  readonly startupPermissions: RuntimePermissionState;
  readonly modelContextWindow: number | null;
  readonly autoCompactTokenLimit: number | null;
}

function emptyRuntimeConfigSnapshot(): RuntimeConfigSnapshot {
  return {
    profile: null,
    model: null,
    modelProvider: null,
    reasoningEffort: null,
    reasoningSummary: null,
    verbosity: null,
    serviceTier: null,
    approvalsReviewer: null,
    startupPermissions: initialRuntimePermissionState(),
    modelContextWindow: null,
    autoCompactTokenLimit: null,
  };
}

export function cloneRuntimeConfigSnapshot(config: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  return {
    ...config,
    startupPermissions: cloneRuntimePermissionState(config.startupPermissions),
  };
}

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigSnapshot {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}
