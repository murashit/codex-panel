import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import type { DisplayItem } from "../display/types";
import { parseServiceTier, serviceTierRequestValue, type ServiceTier, type ServiceTierRequest } from "../app-server/service-tier";
import { defaultCollaborationMode, planCollaborationMode } from "./collaboration-mode";
import { findModelByIdOrName, isReasoningEffort, supportedEffortsForModel } from "./model-runtime";
import { compactModelLabel, compactReasoningEffortLabel } from "./runtime-settings";
export { sortedAvailableModels } from "./model-runtime";

export type RuntimeOverride<T> = { kind: "default" } | { kind: "set"; value: T } | { kind: "resetPending" };

export interface RuntimeSnapshot {
  effectiveConfig: ConfigReadResponse | null;
  activeThreadId: string | null;
  activeModel: string | null;
  activeServiceTier: string | null;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  displayItems: DisplayItem[];
  availableModels: Model[];
}

export interface TurnRuntimeSettings {
  collaborationMode: CollaborationMode | null;
  model: string | null | undefined;
  effort: ReasoningEffort | null | undefined;
  warning: string | null;
}

export function configRecord(effectiveConfig: ConfigReadResponse | null): Record<string, unknown> {
  return asRecord(effectiveConfig?.config);
}

export function currentServiceTier(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string | null {
  return (
    snapshot.requestedServiceTier ??
    parseServiceTier(snapshot.activeServiceTier) ??
    snapshot.activeServiceTier ??
    configuredServiceTier(config)
  );
}

export function requestedOrConfiguredServiceTier(
  snapshot: RuntimeSnapshot,
  config = configRecord(snapshot.effectiveConfig),
): ServiceTierRequest {
  return serviceTierRequestValue(snapshot.requestedServiceTier ?? configuredServiceTier(config));
}

export function currentModel(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): string | null {
  const model = config.model;
  const configModel = typeof model === "string" && model.length > 0 ? model : null;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetPending" && configModel) return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(snapshot: RuntimeSnapshot, config = configRecord(snapshot.effectiveConfig)): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  const effort = config.model_reasoning_effort;
  return isReasoningEffort(effort) ? effort : null;
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
    model: runtimeOverridePayload(snapshot.requestedModel),
    effort: runtimeOverridePayload(snapshot.requestedReasoningEffort),
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

export function commitRuntimeOverride<T>(override: RuntimeOverride<T>): RuntimeOverride<T> {
  return override.kind === "resetPending" ? defaultRuntimeOverride<T>() : override;
}

export function runtimeOverridePayload<T>(override: RuntimeOverride<T>): T | null | undefined {
  if (override.kind === "set") return override.value;
  if (override.kind === "resetPending") return null;
  return undefined;
}

export function runtimeOverrideLabel<T>(override: RuntimeOverride<T>): string {
  if (override.kind === "set") return String(override.value);
  if (override.kind === "resetPending") return "(reset pending)";
  return "(default)";
}

function configuredServiceTier(config: Record<string, unknown>): ServiceTier | null {
  return parseServiceTier(config.service_tier);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
