import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import { cloneRuntimePermissionState, type RuntimeApprovalPolicy, type RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import { type PendingRuntimeIntent, resetRuntimeIntentToConfig, setRuntimeIntentValue, unchangedRuntimeIntent } from "./intent";
import { type RuntimeLayeredValue, resolveRuntimeNullablePendingValue, resolveRuntimeValue } from "./layered-value";
import type { RuntimeSnapshot } from "./snapshot";

export interface RuntimePermissionsResolution {
  readonly permissionProfile: RuntimeLayeredValue<string>;
  readonly sandboxPolicy: RuntimeLayeredValue<RuntimeSandboxPolicy, RuntimeSandboxPolicy | null>;
  readonly approvalPolicy: RuntimeLayeredValue<RuntimeApprovalPolicy>;
}

export function resolveRuntimePermissions(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): RuntimePermissionsResolution {
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
