import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, type ModelMetadata, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import { cloneRuntimePermissionState, type RuntimeApprovalPolicy, type RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import {
  effectiveCollaborationMode,
  type PendingRuntimeIntent,
  type RequestedFastMode,
  resetRuntimeIntentToConfig,
  setRuntimeIntentValue,
  unchangedRuntimeIntent,
} from "./intent";
import type { RuntimeSnapshot } from "./snapshot";

type RuntimeValueSource = "pending" | "active-thread" | "config" | "none";

interface RuntimeLayeredValue<T> {
  readonly configured: T | null;
  readonly active: T | null;
  readonly pending: PendingRuntimeIntent<T>;
  readonly confirmed: T | null;
  readonly confirmedSource: RuntimeValueSource;
  readonly effective: T | null;
  readonly source: RuntimeValueSource;
}

interface RuntimeNullableLayeredValue<T> {
  readonly configured: T | null;
  readonly active: T | null;
  readonly pending: PendingRuntimeIntent<T | null>;
  readonly confirmed: T | null;
  readonly confirmedSource: RuntimeValueSource;
  readonly effective: T | null;
  readonly source: RuntimeValueSource;
}

interface FastModeResolution {
  readonly requested: PendingRuntimeIntent<RequestedFastMode>;
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
  readonly effectiveServiceTier: ServiceTier | null;
  readonly confirmedServiceTier: ServiceTier | null;
  readonly serviceTierRequestValue: string;
}

interface AutoReviewResolution {
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
}

interface CollaborationModeResolution {
  readonly active: RuntimeSnapshot["active"]["collaborationMode"];
  readonly pending: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly confirmed: NonNullable<RuntimeSnapshot["active"]["collaborationMode"]>;
  readonly effective: NonNullable<RuntimeSnapshot["active"]["collaborationMode"]>;
  readonly dirty: boolean;
  readonly blockedReason: "missing-model" | null;
}

export interface RuntimeControlsResolution {
  readonly model: RuntimeLayeredValue<string>;
  readonly reasoningEffort: RuntimeLayeredValue<ReasoningEffort>;
  readonly autoReview: AutoReviewResolution;
  readonly serviceTier: RuntimeLayeredValue<ServiceTier>;
  readonly fastMode: FastModeResolution;
  readonly collaborationMode: CollaborationModeResolution;
  readonly permissionProfile: RuntimeLayeredValue<string>;
  readonly sandboxPolicy: RuntimeNullableLayeredValue<RuntimeSandboxPolicy>;
  readonly approvalPolicy: RuntimeLayeredValue<RuntimeApprovalPolicy>;
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
  const permissionProfile = resolveRuntimePermissionValue({
    configured: config.startupPermissions.activePermissionProfile?.id ?? null,
    active: snapshot.active.activePermissionProfile?.id ?? null,
    pending: snapshot.pending.permissionProfile,
    activeKnown: snapshot.activeThreadId !== null && snapshot.active.permissionProfileKnown,
  });
  const approvalPolicy = resolveRuntimePermissionValue({
    configured: config.startupPermissions.approvalPolicy,
    active: snapshot.active.approvalPolicy,
    pending: snapshot.pending.approvalPolicy,
    activeKnown: snapshot.activeThreadId !== null && snapshot.active.approvalPolicyKnown,
  });
  const sandboxPolicy = resolveRuntimeSandboxPolicy(snapshot, config);
  const autoReview = resolveAutoReview(reviewer);

  return {
    model,
    reasoningEffort,
    autoReview,
    serviceTier,
    fastMode,
    collaborationMode,
    permissionProfile,
    sandboxPolicy,
    approvalPolicy,
    approvalsReviewer: reviewer,
    supportedReasoningEfforts: supportedEffortsForModelMetadata(findModelMetadataByIdOrName(snapshot.availableModels, model.effective)),
  };
}

function resolveAutoReview(reviewer: RuntimeLayeredValue<ApprovalsReviewer>): AutoReviewResolution {
  return {
    active: reviewer.effective === "auto_review" || reviewer.effective === "guardian_subagent",
    confirmedActive: reviewer.confirmed === "auto_review" || reviewer.confirmed === "guardian_subagent",
    source: reviewer.source,
    confirmedSource: reviewer.confirmedSource,
  };
}

function resolveRuntimeSandboxPolicy(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
): RuntimeNullableLayeredValue<RuntimeSandboxPolicy> {
  const pending = sandboxPolicyIntentFromPermissionProfile(snapshot.pending.permissionProfile, config);
  return resolveNullableRuntimePermissionValue({
    configured: cloneRuntimeSandboxPolicy(config.startupPermissions.sandboxPolicy),
    active: cloneRuntimeSandboxPolicy(snapshot.active.sandboxPolicy),
    pending,
    activeKnown: snapshot.activeThreadId !== null && snapshot.active.sandboxPolicyKnown,
  });
}

function sandboxPolicyIntentFromPermissionProfile(
  intent: PendingRuntimeIntent<string>,
  config: RuntimeConfigSnapshot,
): PendingRuntimeIntent<RuntimeSandboxPolicy | null> {
  if (intent.kind === "set") {
    return setRuntimeIntentValue(sandboxPolicyForPermissionProfile(intent.value, config));
  }
  if (intent.kind === "resetToConfig") return resetRuntimeIntentToConfig();
  return unchangedRuntimeIntent();
}

function sandboxPolicyForPermissionProfile(profile: string, config: RuntimeConfigSnapshot): RuntimeSandboxPolicy | null {
  return profile === config.startupPermissions.activePermissionProfile?.id
    ? cloneRuntimeSandboxPolicy(config.startupPermissions.sandboxPolicy)
    : null;
}

function cloneRuntimeSandboxPolicy(value: RuntimeSandboxPolicy | null): RuntimeSandboxPolicy | null {
  return cloneRuntimePermissionState({ approvalPolicy: null, activePermissionProfile: null, sandboxPolicy: value }).sandboxPolicy;
}

function resolveRuntimePermissionValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<T>;
  activeKnown: boolean;
}): RuntimeLayeredValue<T> {
  if (input.pending.kind !== "unchanged") {
    const value = resolveRuntimeValue({
      configured: input.configured,
      active: input.active,
      pending: input.pending,
    });
    return { ...value, ...confirmedRuntimeValue(input.configured, input.active, input.activeKnown) };
  }
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const pending = input.pending;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(input.configured, input.active, input.activeKnown);
  return { configured, active, pending, confirmed, confirmedSource, effective: confirmed, source: confirmedSource };
}

function resolveNullableRuntimePermissionValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<T | null>;
  activeKnown: boolean;
}): RuntimeNullableLayeredValue<T> {
  if (input.pending.kind !== "unchanged") {
    const value = resolveRuntimeValue({
      configured: input.configured,
      active: input.active,
      pending: input.pending,
    });
    return { ...value, ...confirmedRuntimeValue(input.configured, input.active, input.activeKnown) };
  }
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const pending = input.pending;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(input.configured, input.active, input.activeKnown);
  return { configured, active, pending, confirmed, confirmedSource, effective: confirmed, source: confirmedSource };
}

function resolveRuntimeValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<T> | undefined;
}): RuntimeLayeredValue<T> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const pending = input.pending ?? ({ kind: "unchanged" } satisfies PendingRuntimeIntent<T>);
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, active !== null);
  if (pending.kind === "set") {
    return { configured, active, pending, confirmed, confirmedSource, effective: pending.value, source: "pending" };
  }
  if (pending.kind === "resetToConfig") {
    return { configured, active, pending, confirmed, confirmedSource, effective: configured, source: "config" };
  }
  return { configured, active, pending, confirmed, confirmedSource, effective: confirmed, source: confirmedSource };
}

function confirmedRuntimeValue<T>(
  configured: T | null | undefined,
  active: T | null | undefined,
  activeKnown: boolean,
): Pick<RuntimeLayeredValue<T>, "confirmed" | "confirmedSource"> {
  const configuredValue = configured ?? null;
  const activeValue = active ?? null;
  if (activeKnown) return { confirmed: activeValue, confirmedSource: "active-thread" };
  if (configuredValue !== null) return { confirmed: configuredValue, confirmedSource: "config" };
  return { confirmed: null, confirmedSource: "none" };
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
  const { confirmed, confirmedSource } = confirmedRuntimeValue(
    config.serviceTier,
    snapshot.active.serviceTier,
    snapshot.activeThreadId !== null && snapshot.active.serviceTierKnown,
  );
  return {
    configured: config.serviceTier,
    active: snapshot.active.serviceTier,
    pending: { kind: "unchanged" },
    confirmed,
    confirmedSource,
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
    confirmedActive: isFastServiceTier(serviceTier.confirmed, serviceTiers),
    source: serviceTier.source,
    confirmedSource: serviceTier.confirmedSource,
    effectiveServiceTier: serviceTier.effective,
    confirmedServiceTier: serviceTier.confirmed,
    serviceTierRequestValue: serviceTiers.find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast",
  };
}

function resolveCollaborationMode(snapshot: RuntimeSnapshot, model: string | null): CollaborationModeResolution {
  const active = snapshot.active.collaborationMode;
  const pending = snapshot.pending.collaborationMode;
  const confirmed = effectiveCollaborationMode(active);
  const effective = pending.kind === "set" ? pending.value : confirmed;
  const dirty = pending.kind === "set";
  return {
    active,
    pending,
    confirmed,
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
