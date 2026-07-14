import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { DiagnosticRow, DiagnosticSection } from "./diagnostic-sections";

interface RuntimePermissionSectionsInput {
  snapshot: RuntimeSnapshot;
  vaultPath: string;
}

export function runtimePermissionSections(input: RuntimePermissionSectionsInput): DiagnosticSection[] {
  const config = runtimeConfigOrDefault(input.snapshot.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  return [
    {
      title: "Permissions",
      rows: accessRows(resolution.permissionProfile.effective, resolution.sandboxPolicy.effective, input.vaultPath),
    },
    {
      title: "Approvals",
      rows: approvalRows(resolution.approvalPolicy.confirmed, resolution.autoReview.confirmedActive),
    },
  ];
}

function accessRows(profile: string | null, sandbox: RuntimeSandboxPolicy | null, vaultPath: string): DiagnosticRow[] {
  return [
    { label: "Profile", value: profileLabel(profile, sandbox) },
    { label: "Sandbox", value: sandboxLabel(sandbox) },
    { label: "Codex network", value: networkLabel(sandbox) },
    { label: "Extra writable roots", value: writableRootsLabel(sandbox, vaultPath) },
  ];
}

function approvalRows(policy: RuntimeApprovalPolicy | null, autoReview: boolean): DiagnosticRow[] {
  return [
    { label: "Approval policy", value: approvalPolicyLabel(policy) },
    {
      label: "Auto review",
      value: autoReview ? "on" : "off",
    },
  ];
}

function profileLabel(profile: string | null, sandbox: RuntimeSandboxPolicy | null): string {
  if (profile) return profile;
  if (sandbox) return "(legacy sandbox)";
  return "(not reported)";
}

function sandboxLabel(sandbox: RuntimeSandboxPolicy | null): string {
  if (!sandbox) return "(not reported)";
  switch (sandbox.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "readOnly":
      return "read-only";
    case "workspaceWrite":
      return "workspace-write";
    case "externalSandbox":
      return "external sandbox";
  }
}

function networkLabel(sandbox: RuntimeSandboxPolicy | null): string {
  if (!sandbox) return "(not reported)";
  if (sandbox.type === "dangerFullAccess") return "allowed";
  if (sandbox.type === "externalSandbox") return sandbox.networkAccess;
  return sandbox.networkAccess ? "allowed" : "blocked";
}

function writableRootsLabel(sandbox: RuntimeSandboxPolicy | null, vaultPath: string): string {
  if (!sandbox) return "(not reported)";
  if (sandbox.type === "dangerFullAccess") return "all files";
  if (sandbox.type !== "workspaceWrite") return "-";
  if (sandbox.writableRoots.length === 0) return "(none)";
  return sandbox.writableRoots.map((root) => displayRoot(root, vaultPath)).join(", ");
}

function displayRoot(root: string, vaultPath: string): string {
  if (root === vaultPath) return "Vault";
  if (vaultPath && root.startsWith(`${vaultPath}/`)) return `Vault/${root.slice(vaultPath.length + 1)}`;
  return root;
}

function approvalPolicyLabel(policy: RuntimeApprovalPolicy | null): string {
  if (!policy) return "(not reported)";
  if (typeof policy === "string") return policy;

  const enabled = Object.entries(policy.granular)
    .filter(([, value]) => value)
    .map(([key]) => key.replace(/_/g, " "));
  return enabled.length ? `granular: ${enabled.join(", ")}` : "granular";
}
