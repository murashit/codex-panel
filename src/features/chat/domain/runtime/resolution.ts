import { findModelMetadataByIdOrName, type ReasoningEffort, supportedEffortsForModelMetadata } from "../../../../domain/runtime/catalog";
import { cloneRuntimePermissionState, type RuntimeApprovalPolicy, type RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import { type ApprovalsReviewer, type RuntimeConfigSnapshot, type ServiceTier, sameServiceTier } from "../../../../domain/runtime/settings";
import {
  effectiveCollaborationMode,
  type PendingRuntimeIntent,
  resetRuntimeIntentToConfig,
  setRuntimeIntentValue,
  unchangedRuntimeIntent,
} from "./intent";
import type { RuntimeSnapshot } from "./state";

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
}

interface FastModeResolution {
  readonly available: boolean;
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
  readonly serviceTierRequestValue: string | null;
}

interface RuntimePermissionsResolution {
  readonly permissionProfile: RuntimeLayeredValue<string>;
  readonly sandboxPolicy: RuntimeLayeredValue<RuntimeSandboxPolicy, RuntimeSandboxPolicy | null>;
  readonly approvalPolicy: RuntimeLayeredValue<RuntimeApprovalPolicy>;
}

export interface RuntimeControlsResolution {
  readonly model: RuntimeLayeredValue<string>;
  readonly reasoningEffort: RuntimeLayeredValue<ReasoningEffort, ReasoningEffort | null>;
  readonly autoReview: AutoReviewResolution;
  readonly serviceTier: RuntimeLayeredValue<ServiceTier>;
  readonly fastMode: FastModeResolution;
  readonly collaborationMode: CollaborationModeResolution;
  readonly permissionProfile: RuntimeLayeredValue<string>;
  readonly sandboxPolicy: RuntimeLayeredValue<RuntimeSandboxPolicy, RuntimeSandboxPolicy | null>;
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
  const approvalsReviewer = resolveRuntimeValue({
    configured: config.approvalsReviewer,
    active: snapshot.active.approvalsReviewer,
    pending: snapshot.pending.approvalsReviewer,
  });
  const modelMetadata = findModelMetadataByIdOrName(snapshot.availableModels, model.effective);
  const fastServiceTier = modelMetadata?.serviceTiers.find((tier) => tier.name.trim().toLowerCase() === "fast") ?? null;
  const serviceTier = resolveServiceTier(snapshot, config, fastServiceTier?.id ?? null);
  const permissions = resolveRuntimePermissions(snapshot, config);

  return {
    model,
    reasoningEffort,
    autoReview: resolveAutoReview(approvalsReviewer),
    serviceTier,
    fastMode: resolveFastMode(serviceTier, fastServiceTier?.id ?? null),
    collaborationMode: resolveCollaborationMode(snapshot),
    permissionProfile: permissions.permissionProfile,
    sandboxPolicy: permissions.sandboxPolicy,
    approvalPolicy: permissions.approvalPolicy,
    approvalsReviewer,
    supportedReasoningEfforts: supportedEffortsForModelMetadata(modelMetadata),
  };
}

function resolveServiceTier(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
  fastServiceTierId: string | null,
): RuntimeLayeredValue<ServiceTier> {
  const pendingFastMode = snapshot.pending.fastMode;
  if (pendingFastMode.kind === "set" && pendingFastMode.value === "enabled") {
    return serviceTierValue(snapshot, config, fastServiceTierId, "pending");
  }
  if (pendingFastMode.kind === "set" && pendingFastMode.value === "disabled") {
    return serviceTierValue(snapshot, config, null, "pending");
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
  source: RuntimeLayeredValue<ServiceTier>["source"],
): RuntimeLayeredValue<ServiceTier> {
  return runtimeLayeredValue<ServiceTier>({
    configured: config.serviceTier,
    active: snapshot.active.serviceTier,
    pending: { kind: "unchanged" },
    activeKnown: snapshot.active.serviceTierKnown,
    effective,
    source,
  });
}

function resolveAutoReview(reviewer: RuntimeLayeredValue<ApprovalsReviewer>): AutoReviewResolution {
  return {
    active: autoReviewActive(reviewer.effective),
    confirmedActive: autoReviewActive(reviewer.confirmed),
    source: reviewer.source,
    confirmedSource: reviewer.confirmedSource,
  };
}

function resolveFastMode(serviceTier: RuntimeLayeredValue<ServiceTier>, fastServiceTierId: string | null): FastModeResolution {
  return {
    available: fastServiceTierId !== null,
    active: isFastServiceTier(serviceTier.effective, fastServiceTierId),
    confirmedActive: isFastServiceTier(serviceTier.confirmed, fastServiceTierId),
    source: serviceTier.source,
    confirmedSource: serviceTier.confirmedSource,
    serviceTierRequestValue: fastServiceTierId,
  };
}

function autoReviewActive(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function isFastServiceTier(value: string | null | undefined, fastServiceTierId: string | null): boolean {
  return fastServiceTierId !== null && sameServiceTier(value, fastServiceTierId);
}

function resolveCollaborationMode(snapshot: RuntimeSnapshot): CollaborationModeResolution {
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
  };
}

function resolveRuntimePermissions(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimePermissionsResolution {
  return {
    permissionProfile: resolveRuntimeValue({
      configured: config.startupPermissions.activePermissionProfile?.id ?? null,
      active: snapshot.active.activePermissionProfile?.id ?? null,
      pending: snapshot.pending.permissionProfile,
      activeKnown: snapshot.active.permissionProfileKnown,
    }),
    sandboxPolicy: resolveRuntimeSandboxPolicy(snapshot, config),
    approvalPolicy: resolveRuntimeValue({
      configured: config.startupPermissions.approvalPolicy,
      active: snapshot.active.approvalPolicy,
      pending: unchangedRuntimeIntent(),
      activeKnown: snapshot.active.approvalPolicyKnown,
    }),
  };
}

function resolveRuntimeSandboxPolicy(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
): RuntimeLayeredValue<RuntimeSandboxPolicy, RuntimeSandboxPolicy | null> {
  return resolveRuntimeValue({
    configured: cloneRuntimeSandboxPolicy(config.startupPermissions.sandboxPolicy),
    active: cloneRuntimeSandboxPolicy(snapshot.active.sandboxPolicy),
    pending: sandboxPolicyIntentFromPermissionProfile(snapshot.pending.permissionProfile, config),
    activeKnown: snapshot.active.sandboxPolicyKnown,
  });
}

function sandboxPolicyIntentFromPermissionProfile(
  intent: PendingRuntimeIntent<string>,
  config: RuntimeConfigSnapshot,
): PendingRuntimeIntent<RuntimeSandboxPolicy | null> {
  if (intent.kind === "set") return setRuntimeIntentValue(sandboxPolicyForPermissionProfile(intent.value, config));
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

type RuntimeValueSource = "pending" | "active-thread" | "config" | "none";

interface RuntimeLayeredValue<T, Pending = T> {
  readonly configured: T | null;
  readonly active: T | null;
  readonly pending: PendingRuntimeIntent<Pending>;
  readonly confirmed: T | null;
  readonly confirmedSource: RuntimeValueSource;
  readonly effective: T | null;
  readonly source: RuntimeValueSource;
}

function runtimeLayeredValue<T, Pending = T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<Pending>;
  activeKnown: boolean;
  effective: T | null;
  source: RuntimeValueSource;
}): RuntimeLayeredValue<T, Pending> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, input.activeKnown);
  return {
    configured,
    active,
    pending: input.pending,
    confirmed,
    confirmedSource,
    effective: input.effective,
    source: input.source,
  };
}

function resolveRuntimeValue<T, Pending extends T | null = T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<Pending>;
  activeKnown?: boolean;
}): RuntimeLayeredValue<T, Pending> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const activeKnown = input.activeKnown ?? active !== null;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, activeKnown);
  const base = { configured, active, pending: input.pending, confirmed, confirmedSource };
  switch (input.pending.kind) {
    case "set":
      return { ...base, effective: input.pending.value, source: "pending" };
    case "resetToConfig":
      return { ...base, effective: configured, source: "config" };
    case "unchanged":
      return { ...base, effective: confirmed, source: confirmedSource };
  }
}

function confirmedRuntimeValue<T>(
  configured: T | null,
  active: T | null,
  activeKnown: boolean,
): Pick<RuntimeLayeredValue<T>, "confirmed" | "confirmedSource"> {
  if (activeKnown) return { confirmed: active, confirmedSource: "active-thread" };
  if (configured !== null) return { confirmed: configured, confirmedSource: "config" };
  return { confirmed: null, confirmedSource: "none" };
}
