import { describe, expect, it } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../src/app-server/protocol/runtime-config";

describe("runtime config protocol mapping", () => {
  it("keeps startup permission defaults in the runtime config snapshot", () => {
    expect(
      runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
        approvals_reviewer: "auto_review",
      }),
    ).toMatchObject({
      approvalsReviewer: "auto_review",
      startupPermissions: {
        activePermissionProfile: { id: ":workspace", extends: null },
        approvalPolicy: "on-request",
        sandboxPolicy: null,
      },
    });
  });

  it("keeps default permissions separate from legacy sandbox fields", () => {
    expect(
      runtimeConfigFixture({
        default_permissions: "DevProfile",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
      }),
    ).toMatchObject({
      startupPermissions: {
        activePermissionProfile: { id: "DevProfile", extends: null },
        approvalPolicy: "on-request",
        sandboxPolicy: null,
      },
    });
  });

  it("uses legacy sandbox config when default permissions are not reported", () => {
    expect(
      runtimeConfigFixture({
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
      }),
    ).toMatchObject({
      startupPermissions: {
        activePermissionProfile: null,
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/vault"],
          networkAccess: false,
        },
      },
    });
  });
});

function runtimeConfigFixture(config: Record<string, unknown>) {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
}
