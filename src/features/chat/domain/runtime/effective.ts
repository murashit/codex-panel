import { cloneRuntimeConfigSnapshot, emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "./snapshot";
import { resolveRuntimeControls } from "./resolution";

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigSnapshot {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}

export function currentServiceTier(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | null {
  return resolveRuntimeControls(snapshot, config).serviceTier.effective;
}

export function currentModel(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string | null {
  return resolveRuntimeControls(snapshot, config).model.effective;
}

export function currentReasoningEffort(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ReasoningEffort | null {
  return resolveRuntimeControls(snapshot, config).reasoningEffort.effective;
}

export function autoReviewActive(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): boolean {
  return resolveRuntimeControls(snapshot, config).autoReview.active;
}

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): ReasoningEffort[] {
  return [...resolveRuntimeControls(snapshot, config).supportedReasoningEfforts];
}

export function fastModeActive(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): boolean {
  return resolveRuntimeControls(snapshot, config).fastMode.active;
}

export function fastRuntimeServiceTierRequestValue(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string {
  return resolveRuntimeControls(snapshot, config).fastMode.serviceTierRequestValue;
}
