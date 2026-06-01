import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ActivePermissionProfile } from "../generated/app-server/v2/ActivePermissionProfile";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";
import type { AskForApproval } from "../generated/app-server/v2/AskForApproval";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import {
  configuredServiceTierRequestValue,
  isFastServiceTier,
  requestedServiceTierRequestValue,
  type RequestedServiceTier,
  type ServiceTier,
  type ServiceTierRequest,
} from "../app-server/service-tier";
import { defaultCollaborationMode, planCollaborationMode } from "./collaboration-mode";
import { findModelByIdOrName, supportedEffortsForModel } from "./model";
import { compactModelLabel, compactReasoningEffortLabel } from "./settings";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";

export type PendingRuntimeSetting<T> = { kind: "unchanged" } | { kind: "set"; value: T } | { kind: "resetToConfig" };

export interface RuntimeSnapshot {
  effectiveConfig: ConfigReadResponse | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: AskForApproval | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: ModeKind;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly Model[];
}

export interface TurnRuntimeSettings {
  collaborationMode: CollaborationMode | null;
  warning: string | null;
}

export function currentServiceTier(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string | null {
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "fast") return "fast";
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "off") return null;
  if (snapshot.requestedServiceTier.kind === "resetToConfig") return config.serviceTier;
  return snapshot.activeServiceTier ?? config.serviceTier;
}

export function requestedOrConfiguredServiceTier(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ServiceTierRequest {
  if (snapshot.requestedServiceTier.kind === "set") {
    return requestedServiceTierRequestValue(snapshot.requestedServiceTier.value, fastServiceTierRequestValue(snapshot, config));
  }
  if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    return null;
  }
  return configuredServiceTierRequestValue(config.serviceTier);
}

export function currentModel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string | null {
  const configModel = config.model;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetToConfig" && configModel) return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  if (snapshot.requestedReasoningEffort.kind === "resetToConfig") return config.reasoningEffort;
  return snapshot.activeReasoningEffort ?? config.reasoningEffort;
}

export function currentApprovalsReviewer(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ApprovalsReviewer | null {
  if (snapshot.requestedApprovalsReviewer.kind === "set") return snapshot.requestedApprovalsReviewer.value;
  if (snapshot.requestedApprovalsReviewer.kind === "resetToConfig") return config.approvalsReviewer;
  return snapshot.activeApprovalsReviewer ?? config.approvalsReviewer;
}

export function currentApprovalPolicy(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): AskForApproval | null {
  return snapshot.activeApprovalPolicy ?? config.approvalPolicy;
}

export function autoReviewActive(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): boolean {
  return isAutoReviewReviewer(currentApprovalsReviewer(snapshot, config));
}

export function requestedTurnRuntimeSettings(snapshot: RuntimeSnapshot): TurnRuntimeSettings {
  const model = currentModel(snapshot);
  const effort = currentReasoningEffort(snapshot);
  const collaborationMode = model
    ? snapshot.selectedCollaborationMode === "plan"
      ? planCollaborationMode(model, effort)
      : defaultCollaborationMode(model, effort)
    : null;
  return {
    collaborationMode,
    warning: model ? null : "No effective model is available. Sending without a mode override.",
  };
}

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot): ReasoningEffort[] {
  const model = currentModel(snapshot);
  return supportedEffortsForModel(findModelByIdOrName(snapshot.availableModels, model));
}

export function runtimeSummaryLabel(model: string | null, effort: ReasoningEffort | null): string {
  const modelLabel = compactModelLabel(model);
  if (!effort) return modelLabel;
  return `${modelLabel} ${compactReasoningEffortLabel(effort)}`;
}

export function serviceTierLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string {
  return currentServiceTier(snapshot, config) ?? "(Codex default)";
}

export function fastModeActive(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): boolean {
  return isFastServiceTier(currentServiceTier(snapshot, config), currentModelServiceTiers(snapshot, config));
}

export function fastModeLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string {
  if (snapshot.requestedServiceTier.kind === "set" && snapshot.requestedServiceTier.value === "off") return "off";
  if (fastModeActive(snapshot, config)) return "on";
  const serviceTier = currentServiceTier(snapshot, config);
  return serviceTier ? "off" : "Codex default";
}

export function fastServiceTierRequestValue(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
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

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function currentModelServiceTiers(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): Model["serviceTiers"] {
  return findModelByIdOrName(snapshot.availableModels, currentModel(snapshot, config))?.serviceTiers ?? [];
}
