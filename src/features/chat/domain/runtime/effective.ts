import { cloneRuntimeConfigSnapshot, emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import { findModelMetadataByIdOrName, type ModelMetadata } from "../../../../domain/catalog/metadata";
import type { ApprovalsReviewer } from "../../../../domain/runtime/policy";
import { supportedEffortsForModelMetadata, type ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "./snapshot";

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigSnapshot {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}

export function currentServiceTier(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | null {
  if (snapshot.requestedFastMode.kind === "set" && snapshot.requestedFastMode.value === "enabled") return "fast";
  if (snapshot.requestedFastMode.kind === "set" && snapshot.requestedFastMode.value === "disabled") return null;
  if (snapshot.requestedFastMode.kind === "resetToConfig") return config.serviceTier;
  return snapshot.activeServiceTier ?? config.serviceTier;
}

export function currentModel(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | null {
  const configModel = config.model;
  if (snapshot.requestedModel.kind === "set") return snapshot.requestedModel.value;
  if (snapshot.requestedModel.kind === "resetToConfig") return configModel;
  return snapshot.activeModel ?? configModel;
}

export function currentReasoningEffort(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ReasoningEffort | null {
  if (snapshot.requestedReasoningEffort.kind === "set") return snapshot.requestedReasoningEffort.value;
  if (snapshot.requestedReasoningEffort.kind === "resetToConfig") return config.reasoningEffort;
  return snapshot.activeReasoningEffort ?? config.reasoningEffort;
}

function currentApprovalsReviewer(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ApprovalsReviewer | null {
  if (snapshot.requestedApprovalsReviewer.kind === "set") return snapshot.requestedApprovalsReviewer.value;
  if (snapshot.requestedApprovalsReviewer.kind === "resetToConfig") return config.approvalsReviewer;
  return snapshot.activeApprovalsReviewer ?? config.approvalsReviewer;
}

export function autoReviewActive(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): boolean {
  return isAutoReviewReviewer(currentApprovalsReviewer(snapshot, config));
}

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ReasoningEffort[] {
  const model = currentModel(snapshot, config);
  return supportedEffortsForModelMetadata(findModelMetadataByIdOrName(snapshot.availableModels, model));
}

export function fastModeActive(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): boolean {
  return isFastServiceTier(currentServiceTier(snapshot, config), currentModelServiceTiers(snapshot, config));
}

function isFastServiceTier(value: string | null | undefined, serviceTiers: ModelMetadata["serviceTiers"] = []): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}

export function fastRuntimeServiceTierRequestValue(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string {
  return currentModelServiceTiers(snapshot, config).find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast";
}

function currentModelServiceTiers(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ModelMetadata["serviceTiers"] {
  return findModelMetadataByIdOrName(snapshot.availableModels, currentModel(snapshot, config))?.serviceTiers ?? [];
}
