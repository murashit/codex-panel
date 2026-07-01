export type RuntimeApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    };

interface RuntimeActivePermissionProfile {
  readonly id: string;
  readonly extends: string | null;
}

type RuntimeNetworkAccess = "restricted" | "enabled";

export type RuntimeSandboxPolicy =
  | { readonly type: "dangerFullAccess" }
  | { readonly type: "readOnly"; readonly networkAccess: boolean }
  | { readonly type: "externalSandbox"; readonly networkAccess: RuntimeNetworkAccess }
  | {
      readonly type: "workspaceWrite";
      readonly writableRoots: readonly string[];
      readonly networkAccess: boolean;
      readonly excludeTmpdirEnvVar: boolean;
      readonly excludeSlashTmp: boolean;
    };

export interface RuntimePermissionState {
  readonly approvalPolicy: RuntimeApprovalPolicy | null;
  readonly sandboxPolicy: RuntimeSandboxPolicy | null;
  readonly activePermissionProfile: RuntimeActivePermissionProfile | null;
}

export interface RuntimePermissionKnownState {
  readonly approvalPolicyKnown: boolean;
  readonly sandboxPolicyKnown: boolean;
  readonly permissionProfileKnown: boolean;
}

export function initialRuntimePermissionState(): RuntimePermissionState {
  return {
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
  };
}

export function initialRuntimePermissionKnownState(): RuntimePermissionKnownState {
  return {
    approvalPolicyKnown: false,
    sandboxPolicyKnown: false,
    permissionProfileKnown: false,
  };
}

export function runtimePermissionStateOrDefault(value: Partial<RuntimePermissionState> | null | undefined): RuntimePermissionState {
  return {
    approvalPolicy: value?.approvalPolicy ? cloneRuntimeApprovalPolicy(value.approvalPolicy) : null,
    sandboxPolicy: value?.sandboxPolicy ? cloneRuntimeSandboxPolicy(value.sandboxPolicy) : null,
    activePermissionProfile: value?.activePermissionProfile ? { ...value.activePermissionProfile } : null,
  };
}

export function cloneRuntimePermissionState(value: RuntimePermissionState): RuntimePermissionState {
  return runtimePermissionStateOrDefault(value);
}

function cloneRuntimeApprovalPolicy(value: RuntimeApprovalPolicy): RuntimeApprovalPolicy {
  if (typeof value === "string") return value;
  return {
    granular: { ...value.granular },
  };
}

function cloneRuntimeSandboxPolicy(value: RuntimeSandboxPolicy): RuntimeSandboxPolicy {
  if (value.type !== "workspaceWrite") return { ...value };
  return {
    ...value,
    writableRoots: [...value.writableRoots],
  };
}
