import type { ActivePermissionProfile, RuntimeConfigSnapshot } from "../../../app-server/runtime-config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../app-server/runtime-metrics";
import type { ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../../app-server/runtime-policy";
import type { ModelMetadata, ReasoningEffort } from "../../../domain/catalog/metadata";

export type CollaborationMode = "default" | "plan";
export type PendingRuntimeSetting<T> = { kind: "unchanged" } | { kind: "set"; value: T } | { kind: "resetToConfig" };
export type RequestedServiceTier = "fast" | "off";

export interface RuntimeSnapshot {
  runtimeConfig: RuntimeConfigSnapshot | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: CollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: ApprovalPolicy | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: CollaborationMode;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly ModelMetadata[];
}

export function unchangedRuntimeSetting<T>(): PendingRuntimeSetting<T> {
  return { kind: "unchanged" };
}

export function setPendingRuntimeSetting<T>(value: T): PendingRuntimeSetting<T> {
  return { kind: "set", value };
}

export function resetRuntimeSettingToConfig<T>(): PendingRuntimeSetting<T> {
  return { kind: "resetToConfig" };
}

export function nextCollaborationMode(mode: CollaborationMode): CollaborationMode {
  return mode === "plan" ? "default" : "plan";
}

export function collaborationModeLabel(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function pendingRuntimeSettingLabel<T>(setting: PendingRuntimeSetting<T>): string {
  if (setting.kind === "set") return String(setting.value);
  if (setting.kind === "resetToConfig") return "(reset to config)";
  return "(none)";
}
