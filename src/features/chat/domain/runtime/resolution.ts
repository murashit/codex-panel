import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
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
import {
  type RuntimeLayeredValue,
  type RuntimeValueSource,
  resolveRuntimeNullablePendingValue,
  resolveRuntimeValue,
  runtimeLayeredValue,
} from "./layered-value";
import type { RuntimeSnapshot } from "./snapshot";

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

interface FastModeResolution {
  readonly available: boolean;
  readonly requested: PendingRuntimeIntent<RequestedFastMode>;
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
  readonly effectiveServiceTier: ServiceTier | null;
  readonly confirmedServiceTier: ServiceTier | null;
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
  const reasoningEffort = resolveRuntimeNullablePendingValue({
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
    fastMode: resolveFastMode(snapshot.pending.fastMode, serviceTier, fastServiceTier?.id ?? null),
    collaborationMode: resolveCollaborationMode(snapshot, model.effective),
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
  source: RuntimeLayeredValue<ServiceTier>["source"],
): RuntimeLayeredValue<ServiceTier> {
  return runtimeLayeredValue<ServiceTier>({
    configured: config.serviceTier,
    active: snapshot.active.serviceTier,
    pending: { kind: "unchanged" },
    activeKnown: snapshot.activeThreadId !== null && snapshot.active.serviceTierKnown,
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

function resolveFastMode(
  requested: PendingRuntimeIntent<RequestedFastMode>,
  serviceTier: RuntimeLayeredValue<ServiceTier>,
  fastServiceTierId: string | null,
): FastModeResolution {
  return {
    available: fastServiceTierId !== null,
    requested,
    active: isFastServiceTier(serviceTier.effective, fastServiceTierId),
    confirmedActive: isFastServiceTier(serviceTier.confirmed, fastServiceTierId),
    source: serviceTier.source,
    confirmedSource: serviceTier.confirmedSource,
    effectiveServiceTier: serviceTier.effective,
    confirmedServiceTier: serviceTier.confirmed,
    serviceTierRequestValue: fastServiceTierId,
  };
}

function autoReviewActive(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function isFastServiceTier(value: string | null | undefined, fastServiceTierId: string | null): boolean {
  return fastServiceTierId !== null && value === fastServiceTierId;
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

function resolveRuntimePermissions(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimePermissionsResolution {
  return {
    permissionProfile: resolveRuntimeValue({
      configured: config.startupPermissions.activePermissionProfile?.id ?? null,
      active: snapshot.active.activePermissionProfile?.id ?? null,
      pending: snapshot.pending.permissionProfile,
      activeKnown: snapshot.activeThreadId !== null && snapshot.active.permissionProfileKnown,
    }),
    sandboxPolicy: resolveRuntimeSandboxPolicy(snapshot, config),
    approvalPolicy: resolveRuntimeValue({
      configured: config.startupPermissions.approvalPolicy,
      active: snapshot.active.approvalPolicy,
      pending: snapshot.pending.approvalPolicy,
      activeKnown: snapshot.activeThreadId !== null && snapshot.active.approvalPolicyKnown,
    }),
  };
}

function resolveRuntimeSandboxPolicy(
  snapshot: RuntimeSnapshot,
  config: RuntimeConfigSnapshot,
): RuntimeLayeredValue<RuntimeSandboxPolicy, RuntimeSandboxPolicy | null> {
  return resolveRuntimeNullablePendingValue({
    configured: cloneRuntimeSandboxPolicy(config.startupPermissions.sandboxPolicy),
    active: cloneRuntimeSandboxPolicy(snapshot.active.sandboxPolicy),
    pending: sandboxPolicyIntentFromPermissionProfile(snapshot.pending.permissionProfile, config),
    activeKnown: snapshot.activeThreadId !== null && snapshot.active.sandboxPolicyKnown,
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
