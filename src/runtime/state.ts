import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import type { DisplayItem } from "../display/types";
import { parseServiceTier, serviceTierRequestValue, type ServiceTier, type ServiceTierRequest } from "../app-server/service-tier";
import { defaultCollaborationMode, planCollaborationMode } from "./collaboration-mode";
import { findModelByIdOrName, isReasoningEffort, supportedEffortsForModel } from "./model";
import { compactModelLabel, compactReasoningEffortLabel } from "./settings";

export type RuntimeOverride<T> = { kind: "default" } | { kind: "set"; value: T } | { kind: "resetPending" };

export interface RuntimeSnapshot {
  effectiveConfig: ConfigReadResponse | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: string | null;
  activeServiceTierOverride: boolean;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activeApprovalsReviewerOverride: boolean;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedApprovalsReviewer: ApprovalsReviewer | null;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  displayItems: DisplayItem[];
  availableModels: Model[];
}

export interface TurnRuntimeSettings {
  collaborationMode: CollaborationMode | null;
  warning: string | null;
}

export function configRecord(effectiveConfig: ConfigReadResponse | null): Record<string, unknown> {
  return fillMissingConfigValues(asRecord(effectiveConfig?.config), effectiveConfig?.layers ?? null);
}

export function selectedProfileConfig(config: Record<string, unknown>): Record<string, unknown> {
  const profileName = typeof config.profile === "string" && config.profile.length > 0 ? config.profile : null;
  return profileName ? asRecord(asRecord(config.profiles)[profileName]) : {};
}

export function resolvedConfigValue(config: Record<string, unknown>, key: string): unknown {
  const profileValue = selectedProfileConfig(config)[key];
  return profileValue === undefined || profileValue === null ? config[key] : profileValue;
}

export function currentServiceTier(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string | null {
  const active = parseServiceTier(snapshot.activeServiceTier) ?? snapshot.activeServiceTier;
  const configured = configuredServiceTier(config);
  if (snapshot.requestedServiceTier !== null) return snapshot.requestedServiceTier;
  if (snapshot.activeServiceTierOverride) return active ?? configured;
  if (configured && (active === null || active === "standard")) return configured;
  return active ?? configured;
}

export function requestedOrConfiguredServiceTier(
  snapshot: RuntimeSnapshot,
  config = configRecord(snapshot.effectiveConfig),
): ServiceTierRequest {
  return serviceTierRequestValue(snapshot.requestedServiceTier ?? configuredServiceTier(config));
}

export function currentModel(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string | null {
  const model = resolvedConfigValue(config, "model");
  const configModel = typeof model === "string" && model.length > 0 ? model : null;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetPending" && configModel) return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  const effort = resolvedConfigValue(config, "model_reasoning_effort");
  if (snapshot.requestedReasoningEffort.kind === "resetPending") return isReasoningEffort(effort) ? effort : null;
  return snapshot.activeReasoningEffort ?? (isReasoningEffort(effort) ? effort : null);
}

export function currentApprovalsReviewer(
  snapshot: RuntimeSnapshot,
  config = configRecord(snapshot.effectiveConfig),
): ApprovalsReviewer | null {
  const configured = configuredApprovalsReviewer(config);
  if (snapshot.requestedApprovalsReviewer !== null) return snapshot.requestedApprovalsReviewer;
  if (snapshot.activeApprovalsReviewerOverride) return snapshot.activeApprovalsReviewer ?? configured;
  if (configured && (!snapshot.activeApprovalsReviewer || snapshot.activeApprovalsReviewer === "user")) return configured;
  return snapshot.activeApprovalsReviewer ?? configured;
}

export function autoReviewActive(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): boolean {
  return isAutoReviewReviewer(currentApprovalsReviewer(snapshot, config));
}

export function configuredApprovalsReviewer(config: Record<string, unknown>): ApprovalsReviewer | null {
  const value = resolvedConfigValue(config, "approvals_reviewer");
  return isApprovalsReviewer(value) ? value : null;
}

export function requestedTurnRuntimeSettings(snapshot: RuntimeSnapshot): TurnRuntimeSettings {
  const model = currentModel(snapshot);
  const effort = currentReasoningEffort(snapshot);
  const collaborationMode = model
    ? snapshot.requestedCollaborationMode === "plan"
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

export function serviceTierLabel(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string {
  return currentServiceTier(snapshot, config) ?? "(not reported)";
}

export function fastModeLabel(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string {
  const serviceTier = currentServiceTier(snapshot, config);
  if (serviceTier === "fast") return "on";
  if (serviceTier === "standard") return "off";
  if (serviceTier) return `unknown (${serviceTier})`;
  return "not reported";
}

export function defaultRuntimeOverride<T>(): RuntimeOverride<T> {
  return { kind: "default" };
}

export function setRuntimeOverride<T>(value: T): RuntimeOverride<T> {
  return { kind: "set", value };
}

export function resetRuntimeOverride<T>(): RuntimeOverride<T> {
  return { kind: "resetPending" };
}

export function runtimeOverridePayload<T>(override: RuntimeOverride<T>): T | null | undefined {
  if (override.kind === "set") return override.value;
  if (override.kind === "resetPending") return null;
  return undefined;
}

export function runtimeOverrideLabel<T>(override: RuntimeOverride<T>): string {
  if (override.kind === "set") return String(override.value);
  if (override.kind === "resetPending") return "(reset to config)";
  return "(none)";
}

export function configuredServiceTier(config: Record<string, unknown>): ServiceTier | null {
  return parseServiceTier(resolvedConfigValue(config, "service_tier"));
}

function isApprovalsReviewer(value: unknown): value is ApprovalsReviewer {
  return value === "user" || value === "auto_review" || value === "guardian_subagent";
}

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function fillMissingConfigValues(config: Record<string, unknown>, layers: ConfigReadResponse["layers"]): Record<string, unknown> {
  if (!layers || layers.length === 0) return config;
  const fallback = rawLayerConfigRecord(layers);
  if (Object.keys(fallback).length === 0) return config;

  const merged = { ...config };
  for (const [key, value] of Object.entries(fallback)) {
    if (merged[key] === undefined || merged[key] === null) {
      merged[key] = value;
    }
  }
  return merged;
}

function rawLayerConfigRecord(layers: NonNullable<ConfigReadResponse["layers"]>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    const config = asRecord(layer.config);
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }
  return merged;
}
