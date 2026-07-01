import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, type ModelMetadata, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import { cloneRuntimePermissionState, type RuntimePermissionState } from "../../../../domain/runtime/permissions";
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
  readonly source: RuntimeValueSource;
}

interface CollaborationModeResolution {
  readonly active: RuntimeSnapshot["active"]["collaborationMode"];
  readonly selected: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly effective: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly dirty: boolean;
  readonly blockedReason: "missing-model" | null;
}

interface RuntimePermissionsResolution {
  readonly scope: "new-thread" | "current-thread";
  readonly configured: RuntimePermissionState;
  readonly active: RuntimePermissionState | null;
  readonly effective: RuntimePermissionState;
  readonly source: RuntimeValueSource;
}

export interface RuntimeControlsResolution {
  readonly model: RuntimeLayeredValue<string>;
  readonly reasoningEffort: RuntimeLayeredValue<ReasoningEffort>;
  readonly autoReview: AutoReviewResolution;
  readonly serviceTier: RuntimeLayeredValue<ServiceTier>;
  readonly fastMode: FastModeResolution;
  readonly collaborationMode: CollaborationModeResolution;
  readonly permissions: RuntimePermissionsResolution;
  readonly approvalsReviewer: RuntimeLayeredValue<ApprovalsReviewer>;
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
  const reviewer = resolveRuntimeValue({
    configured: config.approvalsReviewer,
    active: snapshot.active.approvalsReviewer,
    pending: snapshot.pending.approvalsReviewer,
  });
  const serviceTiers = findModelMetadataByIdOrName(snapshot.availableModels, model.effective)?.serviceTiers ?? [];
  const serviceTier = resolveServiceTier(snapshot, config);
  const fastMode = resolveFastMode(snapshot.pending.fastMode, serviceTier, serviceTiers);
  const collaborationMode = resolveCollaborationMode(snapshot, model.effective);
  const permissions = resolveRuntimePermissions(snapshot, config);
  const autoReview = resolveAutoReview(reviewer);

  return {
    model,
    reasoningEffort,
    autoReview,
    serviceTier,
    fastMode,
    collaborationMode,
    permissions,
    approvalsReviewer: reviewer,
    supportedReasoningEfforts: supportedEffortsForModelMetadata(findModelMetadataByIdOrName(snapshot.availableModels, model.effective)),
  };
}

function resolveAutoReview(reviewer: RuntimeLayeredValue<ApprovalsReviewer>): AutoReviewResolution {
  return {
    active: reviewer.effective === "auto_review" || reviewer.effective === "guardian_subagent",
    source: reviewer.source,
  };
}

function resolveRuntimePermissions(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimePermissionsResolution {
  const configured = cloneRuntimePermissionState(config.startupPermissions);
  const scope = snapshot.activeThreadId ? "current-thread" : "new-thread";
  const baseSource = snapshot.activeThreadId ? "active-thread" : "config";
  if (snapshot.activeThreadId) {
    const active = cloneRuntimePermissionState(snapshot.active);
    const { effective, source } = resolveRuntimePermissionState(
      active,
      configured,
      snapshot.pending.approvalPolicy,
      snapshot.pending.permissionProfile,
      baseSource,
    );
    return {
      scope,
      configured,
      active,
      effective,
      source,
    };
  }
  const { effective, source } = resolveRuntimePermissionState(
    configured,
    configured,
    snapshot.pending.approvalPolicy,
    snapshot.pending.permissionProfile,
    baseSource,
  );
  return {
    scope,
    configured,
    active: null,
    effective,
    source,
  };
}

function resolveRuntimePermissionState(
  base: RuntimePermissionState,
  configured: RuntimePermissionState,
  approvalPolicyIntent: RuntimeSnapshot["pending"]["approvalPolicy"],
  permissionProfileIntent: RuntimeSnapshot["pending"]["permissionProfile"],
  baseSource: RuntimeValueSource,
): Pick<RuntimePermissionsResolution, "effective" | "source"> {
  let effective = cloneRuntimePermissionState(base);
  let source = baseSource;
  const approvalPolicy = runtimePermissionIntentValue(approvalPolicyIntent, configured.approvalPolicy);
  if (approvalPolicy !== undefined) {
    effective = { ...effective, approvalPolicy };
    source = "pending";
  }
  const configuredPermissionProfile = configured.activePermissionProfile?.id ?? null;
  const permissionProfile = runtimePermissionIntentValue(permissionProfileIntent, configuredPermissionProfile);
  if (permissionProfile !== undefined) {
    effective = {
      ...effective,
      sandboxPolicy: permissionProfile === configuredPermissionProfile ? configured.sandboxPolicy : null,
      activePermissionProfile: permissionProfile ? { id: permissionProfile, extends: null } : null,
    };
    source = "pending";
  }
  return { effective: cloneRuntimePermissionState(effective), source };
}

function runtimePermissionIntentValue<T>(intent: PendingRuntimeIntent<T>, configured: T | null): T | null | undefined {
  if (intent.kind === "set") return intent.value;
  if (intent.kind === "resetToConfig") return configured;
  return undefined;
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
    serviceTierRequestValue: serviceTiers.find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast",
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
