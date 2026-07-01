import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimePermissionState, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";

interface RuntimePermissionRow {
  label: string;
  value: string;
}

interface RuntimePermissionSection {
  title: string;
  rows: RuntimePermissionRow[];
}

interface RuntimePermissionDetails {
  title: string;
  sections: RuntimePermissionSection[];
}

interface RuntimePermissionSectionsInput {
  snapshot: RuntimeSnapshot;
  vaultPath: string;
}

export function runtimePermissionDetails(input: RuntimePermissionSectionsInput): RuntimePermissionDetails {
  const config = runtimeConfigOrDefault(input.snapshot.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  return {
    title: "Permissions & Approvals",
    sections: [
      {
        title: "Permissions",
        rows: accessRows(resolution.permissions.effective, input.vaultPath),
      },
      {
        title: "Approvals",
        rows: approvalRows(resolution.permissions.effective, resolution.approvalsReviewer.effective),
      },
    ],
  };
}

function accessRows(permissions: RuntimePermissionState, vaultPath: string): RuntimePermissionRow[] {
  return [
    { label: "Profile", value: profileLabel(permissions) },
    { label: "Sandbox", value: sandboxLabel(permissions.sandboxPolicy) },
    { label: "Network", value: networkLabel(permissions.sandboxPolicy) },
    { label: "Extra writable roots", value: writableRootsLabel(permissions.sandboxPolicy, vaultPath) },
  ];
}

function approvalRows(permissions: RuntimePermissionState, reviewer: string | null): RuntimePermissionRow[] {
  return [
    { label: "Approval policy", value: approvalPolicyLabel(permissions.approvalPolicy) },
    {
      label: "Reviewer",
      value: reviewer ?? "(Codex default)",
    },
  ];
}

function profileLabel(permissions: RuntimePermissionState): string {
  if (permissions.activePermissionProfile) return permissions.activePermissionProfile.id;
  if (permissions.sandboxPolicy) return "(legacy sandbox)";
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

function approvalPolicyLabel(policy: RuntimePermissionState["approvalPolicy"]): string {
  if (!policy) return "(not reported)";
  if (typeof policy === "string") return policy;

  const enabled = Object.entries(policy.granular)
    .filter(([, value]) => value)
    .map(([key]) => key.replace(/_/g, " "));
  return enabled.length ? `granular: ${enabled.join(", ")}` : "granular";
}
