import type { ActivePermissionProfile } from "../../../generated/app-server/v2/ActivePermissionProfile";
import type { AskForApproval } from "../../../generated/app-server/v2/AskForApproval";
import type { ConfigReadResponse } from "../../../generated/app-server/v2/ConfigReadResponse";
import type { RateLimitSnapshot } from "../../../generated/app-server/v2/RateLimitSnapshot";
import type { ThreadTokenUsage } from "../../../generated/app-server/v2/ThreadTokenUsage";
import { findModelOptionByIdOrName, type PanelModelOption } from "../../../domain/catalog/metadata";
import {
  configuredServiceTierRequestValue,
  clearedServiceTierRequestValue,
  serviceTierRequestValue,
  type ServiceTier,
  type ServiceTierRequest,
} from "../../../app-server/thread-settings";
import { supportedEffortsForModelOption, type ReasoningEffort } from "../../../domain/catalog/metadata";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";
import type { PanelCollaborationMode } from "./collaboration";
import { isAutoReviewReviewer, type ApprovalsReviewer } from "./approvals";
import { isFastServiceTier, type RequestedServiceTier } from "./service-tier-state";

export type PendingRuntimeSetting<T> = { kind: "unchanged" } | { kind: "set"; value: T } | { kind: "resetToConfig" };

export interface RuntimeSnapshot {
  effectiveConfig: ConfigReadResponse | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: PanelCollaborationMode;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: AskForApproval | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: PanelCollaborationMode;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly PanelModelOption[];
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
    return snapshot.requestedServiceTier.value === "fast"
      ? serviceTierRequestValue(fastServiceTierRequestValue(snapshot, config))
      : clearedServiceTierRequestValue();
  }
  if (snapshot.requestedServiceTier.kind === "resetToConfig") {
    return clearedServiceTierRequestValue();
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

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot): ReasoningEffort[] {
  const model = currentModel(snapshot);
  return supportedEffortsForModelOption(findModelOptionByIdOrName(snapshot.availableModels, model));
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

function currentModelServiceTiers(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): PanelModelOption["serviceTiers"] {
  return findModelOptionByIdOrName(snapshot.availableModels, currentModel(snapshot, config))?.serviceTiers ?? [];
}
