import {
  cloneRuntimeConfigSnapshot,
  emptyRuntimeConfigSnapshot,
  type ActivePermissionProfile,
  type RuntimeConfigSnapshot,
} from "../../../app-server/runtime-config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../app-server/runtime-metrics";
import { findModelMetadataByIdOrName, type ModelMetadata } from "../../../domain/catalog/metadata";
import type { ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../../app-server/runtime-policy";
import { supportedEffortsForModelMetadata, type ReasoningEffort } from "../../../domain/catalog/metadata";
import type { CollaborationMode } from "./turn-settings";

export type RuntimeConfigProjection = RuntimeConfigSnapshot;
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

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigProjection {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}

export function currentServiceTier(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): string | null {
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "fast") return "fast";
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "off") return null;
  if (snapshot.requestedServiceTier.kind === "resetToConfig") return config.serviceTier;
  return snapshot.activeServiceTier ?? config.serviceTier;
}

export function currentModel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): string | null {
  const configModel = config.model;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetToConfig" && configModel) return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  if (snapshot.requestedReasoningEffort.kind === "resetToConfig") return config.reasoningEffort;
  return snapshot.activeReasoningEffort ?? config.reasoningEffort;
}

export function currentApprovalsReviewer(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): ApprovalsReviewer | null {
  if (snapshot.requestedApprovalsReviewer.kind === "set") return snapshot.requestedApprovalsReviewer.value;
  if (snapshot.requestedApprovalsReviewer.kind === "resetToConfig") return config.approvalsReviewer;
  return snapshot.activeApprovalsReviewer ?? config.approvalsReviewer;
}

export function currentApprovalPolicy(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): ApprovalPolicy | null {
  return snapshot.activeApprovalPolicy ?? config.approvalPolicy;
}

export function autoReviewActive(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): boolean {
  return isAutoReviewReviewer(currentApprovalsReviewer(snapshot, config));
}

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot): ReasoningEffort[] {
  const model = currentModel(snapshot);
  return supportedEffortsForModelMetadata(findModelMetadataByIdOrName(snapshot.availableModels, model));
}

export function serviceTierLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): string {
  return currentServiceTier(snapshot, config) ?? "(Codex default)";
}

export function fastModeActive(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): boolean {
  return isFastServiceTier(currentServiceTier(snapshot, config), currentModelServiceTiers(snapshot, config));
}

export function isFastServiceTier(value: string | null | undefined, serviceTiers: ModelMetadata["serviceTiers"] = []): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}

export function fastModeLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): string {
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "off") return "off";
  if (fastModeActive(snapshot, config)) return "on";
  const serviceTier = currentServiceTier(snapshot, config);
  return serviceTier ? "off" : "Codex default";
}

export function fastServiceTierRequestValue(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): string {
  return currentModelServiceTiers(snapshot, config).find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast";
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

export function pendingRuntimeSettingPayload<T>(setting: PendingRuntimeSetting<T>): T | null | undefined {
  if (setting.kind === "set") return setting.value;
  if (setting.kind === "resetToConfig") return null;
  return undefined;
}

export function pendingRuntimeSettingLabel<T>(setting: PendingRuntimeSetting<T>): string {
  if (setting.kind === "set") return String(setting.value);
  if (setting.kind === "resetToConfig") return "(reset to config)";
  return "(none)";
}

function currentModelServiceTiers(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = runtimeConfigOrDefault(snapshot.runtimeConfig),
): ModelMetadata["serviceTiers"] {
  return findModelMetadataByIdOrName(snapshot.availableModels, currentModel(snapshot, config))?.serviceTiers ?? [];
}
