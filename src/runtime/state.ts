import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import { serviceTierRequestValue, type ServiceTier, type ServiceTierRequest } from "../app-server/service-tier";
import { defaultCollaborationMode, planCollaborationMode } from "./collaboration-mode";
import { findModelByIdOrName, supportedEffortsForModel } from "./model";
import { compactModelLabel, compactReasoningEffortLabel } from "./settings";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";

export type RuntimeOverride<T> = { kind: "default" } | { kind: "set"; value: T } | { kind: "resetPending" };

export interface RuntimeSnapshot {
  effectiveConfig: ConfigReadResponse | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ServiceTier | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedApprovalsReviewer: ApprovalsReviewer | null;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
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
  if (snapshot.requestedServiceTier !== null) return snapshot.requestedServiceTier;
  return snapshot.activeServiceTier ?? config.serviceTier;
}

export function requestedOrConfiguredServiceTier(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ServiceTierRequest {
  return serviceTierRequestValue(snapshot.requestedServiceTier ?? config.serviceTier);
}

export function currentModel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string | null {
  const configModel = config.model;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetPending" && configModel) return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  if (snapshot.requestedReasoningEffort.kind === "resetPending") return config.reasoningEffort;
  return snapshot.activeReasoningEffort ?? config.reasoningEffort;
}

export function currentApprovalsReviewer(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): ApprovalsReviewer | null {
  if (snapshot.requestedApprovalsReviewer !== null) return snapshot.requestedApprovalsReviewer;
  return snapshot.activeApprovalsReviewer ?? config.approvalsReviewer;
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

export function serviceTierLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string {
  return currentServiceTier(snapshot, config) ?? "(Codex default)";
}

export function fastModeLabel(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigProjection = readRuntimeConfig(snapshot.effectiveConfig),
): string {
  const serviceTier = currentServiceTier(snapshot, config);
  if (serviceTier === "fast") return "on";
  if (serviceTier === "standard") return "off";
  return "Codex default";
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

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}
