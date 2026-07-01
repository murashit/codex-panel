import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import { type CollaborationModeResolution, resolveCollaborationMode } from "./collaboration-resolution";
import { type RuntimeLayeredValue, resolveRuntimeValue, runtimeLayeredValue } from "./layered-value";
import { resolveRuntimePermissions } from "./permission-resolution";
import { type AutoReviewResolution, type FastModeResolution, resolveAutoReview, resolveFastMode } from "./runtime-toggles";
import type { RuntimeSnapshot } from "./snapshot";

export interface RuntimeControlsResolution {
  readonly model: RuntimeLayeredValue<string>;
  readonly reasoningEffort: RuntimeLayeredValue<ReasoningEffort>;
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
  const serviceTiers = modelMetadata?.serviceTiers ?? [];
  const serviceTier = resolveServiceTier(snapshot, config);
  const permissions = resolveRuntimePermissions(snapshot, config);

  return {
    model,
    reasoningEffort,
    autoReview: resolveAutoReview(approvalsReviewer),
    serviceTier,
    fastMode: resolveFastMode(snapshot.pending.fastMode, serviceTier, serviceTiers),
    collaborationMode: resolveCollaborationMode(snapshot, model.effective),
    permissionProfile: permissions.permissionProfile,
    sandboxPolicy: permissions.sandboxPolicy,
    approvalPolicy: permissions.approvalPolicy,
    approvalsReviewer,
    supportedReasoningEfforts: supportedEffortsForModelMetadata(modelMetadata),
  };
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
