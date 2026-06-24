import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, type ModelMetadata, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import { effectiveCollaborationMode, type PendingRuntimeIntent, type RequestedFastMode } from "./intent";
import type { RuntimeSnapshot } from "./snapshot";

type RuntimeValueSource = "pending" | "active-thread" | "config" | "none";

interface RuntimeLayeredValue<T> {
  readonly configured: T | null;
  readonly active: T | null;
  readonly pending: PendingRuntimeIntent<T>;
  readonly effective: T | null;
  readonly source: RuntimeValueSource;
}

interface FastModeResolution {
  readonly requested: PendingRuntimeIntent<RequestedFastMode>;
  readonly active: boolean;
  readonly source: RuntimeValueSource;
  readonly effectiveServiceTier: ServiceTier | null;
  readonly serviceTierRequestValue: string;
}

interface AutoReviewResolution {
  readonly active: boolean;
  readonly reviewer: ApprovalsReviewer | null;
  readonly source: RuntimeValueSource;
}

interface CollaborationModeResolution {
  readonly active: RuntimeSnapshot["active"]["collaborationMode"];
  readonly selected: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly effective: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly dirty: boolean;
  readonly blockedReason: "missing-model" | null;
}

export interface RuntimeControlsResolution {
  readonly model: RuntimeLayeredValue<string>;
  readonly reasoningEffort: RuntimeLayeredValue<ReasoningEffort>;
  readonly approvalsReviewer: RuntimeLayeredValue<ApprovalsReviewer>;
  readonly autoReview: AutoReviewResolution;
  readonly serviceTier: RuntimeLayeredValue<ServiceTier>;
  readonly fastMode: FastModeResolution;
  readonly collaborationMode: CollaborationModeResolution;
  readonly supportedReasoningEfforts: readonly ReasoningEffort[];
}

export function resolveRuntimeControls(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeControlsResolution {
  const model = resolveRuntimeValue({
    configured: config.model,
    active: snapshot.active.model,
    pending: snapshot.pending.model,
  });
  const reasoningEffort = resolveRuntimeValue({
    configured: config.reasoningEffort,
    active: snapshot.active.reasoningEffort,
    pending: snapshot.pending.reasoningEffort,
  });
  const approvalsReviewer = resolveRuntimeValue({
    configured: config.approvalsReviewer,
    active: snapshot.active.approvalsReviewer,
    pending: snapshot.pending.approvalsReviewer,
  });
  const autoReview = resolveAutoReview(approvalsReviewer);
  const serviceTiers = modelServiceTiers(snapshot.availableModels, model.effective);
  const serviceTier = resolveServiceTier(snapshot, config);
  const fastMode = resolveFastMode(snapshot.pending.fastMode, serviceTier, serviceTiers);
  const collaborationMode = resolveCollaborationMode(snapshot, model.effective);

  return {
    model,
    reasoningEffort,
    approvalsReviewer,
    autoReview,
    serviceTier,
    fastMode,
    collaborationMode,
    supportedReasoningEfforts: supportedEffortsForModelMetadata(findModelMetadataByIdOrName(snapshot.availableModels, model.effective)),
  };
}

function resolveAutoReview(approvalsReviewer: RuntimeLayeredValue<ApprovalsReviewer>): AutoReviewResolution {
  return {
    active: isAutoReviewReviewer(approvalsReviewer.effective),
    reviewer: approvalsReviewer.effective,
    source: approvalsReviewer.source,
  };
}

function resolveRuntimeValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<T> | undefined;
}): RuntimeLayeredValue<T> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const pending = input.pending ?? ({ kind: "unchanged" } satisfies PendingRuntimeIntent<T>);
  if (pending.kind === "set") {
    return { configured, active, pending, effective: pending.value, source: "pending" };
  }
  if (pending.kind === "resetToConfig") {
    return { configured, active, pending, effective: configured, source: "config" };
  }
  if (active !== null) {
    return { configured, active, pending, effective: active, source: "active-thread" };
  }
  if (configured !== null) {
    return { configured, active, pending, effective: configured, source: "config" };
  }
  return { configured, active, pending, effective: null, source: "none" };
}

function resolveServiceTier(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimeLayeredValue<ServiceTier> {
  const pendingFastMode = snapshot.pending.fastMode;
  if (pendingFastMode.kind === "set" && pendingFastMode.value === "enabled") {
    return serviceTierValue(snapshot, config, "fast", "pending");
  }
  if (pendingFastMode.kind === "set" && pendingFastMode.value === "disabled") {
    return serviceTierValue(snapshot, config, null, "pending");
  }
  if (pendingFastMode.kind === "resetToConfig") {
    return serviceTierValue(snapshot, config, config.serviceTier, "config");
  }
  if (snapshot.active.serviceTierKnown) {
    return serviceTierValue(snapshot, config, snapshot.active.serviceTier, "active-thread");
  }
  return resolveRuntimeValue({
    configured: config.serviceTier,
    active: snapshot.active.serviceTier,
    pending: { kind: "unchanged" },
  });
}

function serviceTierValue(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
  effective: ServiceTier | null,
  source: RuntimeValueSource,
): RuntimeLayeredValue<ServiceTier> {
  return {
    configured: config.serviceTier,
    active: snapshot.active.serviceTier,
    pending: { kind: "unchanged" },
    effective,
    source,
  };
}

function resolveFastMode(
  requested: PendingRuntimeIntent<RequestedFastMode>,
  serviceTier: RuntimeLayeredValue<ServiceTier>,
  serviceTiers: ModelMetadata["serviceTiers"],
): FastModeResolution {
  return {
    requested,
    active: isFastServiceTier(serviceTier.effective, serviceTiers),
    source: serviceTier.source,
    effectiveServiceTier: serviceTier.effective,
    serviceTierRequestValue: fastServiceTierRequestValue(serviceTiers),
  };
}

function resolveCollaborationMode(snapshot: RuntimeSnapshot, model: string | null): CollaborationModeResolution {
  const active = snapshot.active.collaborationMode;
  const selected = snapshot.pending.collaborationMode;
  const effective = effectiveCollaborationMode(active);
  const dirty = selected !== effective;
  return {
    active,
    selected,
    effective,
    dirty,
    blockedReason: dirty && !model ? "missing-model" : null,
  };
}

function isFastServiceTier(value: string | null | undefined, serviceTiers: ModelMetadata["serviceTiers"]): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}

function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function fastServiceTierRequestValue(serviceTiers: ModelMetadata["serviceTiers"]): string {
  return serviceTiers.find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast";
}

function modelServiceTiers(models: readonly ModelMetadata[], model: string | null): ModelMetadata["serviceTiers"] {
  return findModelMetadataByIdOrName(models, model)?.serviceTiers ?? [];
}
