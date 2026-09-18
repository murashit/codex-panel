import type { ReasoningEffort } from "./catalog";
import {
  cloneRuntimePermissionState,
  initialRuntimePermissionState,
  type RuntimeApprovalPolicy,
  type RuntimePermissionState,
} from "./permissions";

export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type ServiceTier = string;

export function approvalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function parseServiceTier(value: unknown): ServiceTier | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

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

function cloneRuntimeConfigSnapshot(config: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  return {
    ...config,
    startupPermissions: cloneRuntimePermissionState(config.startupPermissions),
  };
}

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigSnapshot {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}

export type RuntimeServiceTierRequest = string | null | undefined;
export type ModeKind = "plan" | "default";

export interface CollaborationMode {
  mode: ModeKind;
  settings: {
    model: string;
    reasoningEffort: ReasoningEffort | null;
    developerInstructions: string | null;
  };
}

export interface RuntimeSettingsPatch {
  approvalPolicy?: RuntimeApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  permissions?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  collaborationMode?: CollaborationMode | null;
}

export function applyRuntimeSettingsPatchValue<K extends keyof RuntimeSettingsPatch>(
  update: RuntimeSettingsPatch,
  key: K,
  value: RuntimeSettingsPatch[K] | undefined,
): void {
  if (value !== undefined) update[key] = value;
}

export function runtimeCollaborationModeSettings(
  mode: ModeKind,
  model: string,
  reasoningEffort: ReasoningEffort | null,
): CollaborationMode {
  return {
    mode,
    settings: {
      model,
      reasoningEffort,
      developerInstructions: null,
    },
  };
}
