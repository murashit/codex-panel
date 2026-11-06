import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import { autoReviewChangeRestriction, runtimeConfigOrDefault } from "../../../../domain/runtime/settings";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { ToolbarStatusRow as DiagnosticRow, ToolbarStatusSection as DiagnosticSection } from "../toolbar/model";

interface RuntimePermissionSectionsInput {
  snapshot: RuntimeSnapshot;
  vaultPath: string;
}

export function runtimePermissionSections(input: RuntimePermissionSectionsInput): DiagnosticSection[] {
  const config = runtimeConfigOrDefault(input.snapshot.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  const reviewActive = input.snapshot.activeThreadId ? resolution.autoReview.confirmedActive : resolution.autoReview.active;
  const reviewRestriction =
    input.snapshot.settingsStatus === "unavailable"
      ? "Current settings are unavailable. Reconnect with /reconnect or change the settings again."
      : input.snapshot.settingsStatus === "auto-review-unconfirmed"
        ? `Auto-review was last confirmed ${reviewActive ? "on" : "off"}. This setting will be requested for the next turn.`
        : autoReviewChangeRestriction(config, !reviewActive);
  const approvals = approvalRows(resolution.approvalPolicy.confirmed, reviewActive);
  if (input.snapshot.settingsStatus === "unavailable") approvals[1] = { label: "Auto review", value: "unavailable" };
  else if (input.snapshot.settingsStatus === "auto-review-unconfirmed")
    approvals[1] = { label: "Auto review", value: `last confirmed ${reviewActive ? "on" : "off"}` };
  if (config.requirementsUnavailable) {
    approvals.push({
      label: "Requirements",
      value: "unavailable",
      level: "warning",
    });
  }
  return [
    {
      title: "Permissions",
      rows: accessRows(resolution.permissionProfile.effective, resolution.sandboxPolicy.effective, input.vaultPath),
    },
    {
      title: "Approvals",
      rows: approvals,
      description: [
        reviewRestriction,
        config.requirementsUnavailable ? "Could not check which changes are allowed. Codex will check changes when you submit them." : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];
}

function accessRows(profile: string | null, sandbox: RuntimeSandboxPolicy | null, vaultPath: string): DiagnosticRow[] {
  return [
    { label: "Profile", value: profileLabel(profile, sandbox) },
    { label: "Sandbox", value: sandboxLabel(sandbox) },
    { label: "Sandbox network", value: networkLabel(sandbox) },
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
