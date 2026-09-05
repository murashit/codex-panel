import { describe, expect, it } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../src/app-server/protocol/runtime-config";

describe("runtime config protocol mapping", () => {
  it("maps the complete non-permission runtime snapshot", () => {
    expect(
      runtimeConfigSnapshotFromAppServerConfig({
        config: {
          model: "gpt-5.6",
          model_provider: "openai",
          model_reasoning_effort: "high",
          model_reasoning_summary: "concise",
          model_verbosity: "low",
          service_tier: "fast",
          model_context_window: 200_000,
          model_auto_compact_token_limit: 180_000,
        },
        layers: [{ name: { type: "user", profile: "work" }, config: {} }],
      }),
    ).toMatchObject({
      profile: "work",
      model: "gpt-5.6",
      modelProvider: "openai",
      reasoningEffort: "high",
      reasoningSummary: "concise",
      verbosity: "low",
      serviceTier: "fast",
      modelContextWindow: 200_000,
      autoCompactTokenLimit: 180_000,
    });
  });

  it.each([
    { mode: "danger-full-access", expected: { type: "dangerFullAccess" } },
    { mode: "read-only", expected: { type: "readOnly", networkAccess: false } },
  ])("maps the $mode sandbox policy", ({ mode, expected }) => {
    expect(runtimeConfigFixture({ sandbox_mode: mode }).startupPermissions.sandboxPolicy).toEqual(expected);
  });

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

  it.each([false, true])("preserves legacy workspace sandbox flags set to %s when no permission profile is reported", (enabled) => {
    expect(
      runtimeConfigFixture({
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: enabled,
          exclude_tmpdir_env_var: enabled,
          exclude_slash_tmp: enabled,
        },
      }),
    ).toMatchObject({
      startupPermissions: {
        activePermissionProfile: null,
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/vault"],
          networkAccess: enabled,
          excludeTmpdirEnvVar: enabled,
          excludeSlashTmp: enabled,
        },
      },
    });
  });

  it.each(["untrusted", "on-request", "never"] as const)("normalizes the %s startup approval policy", (approvalPolicy) => {
    expect(runtimeConfigFixture({ approval_policy: approvalPolicy }).startupPermissions.approvalPolicy).toBe(approvalPolicy);
  });

  it.each([
    { name: "null", approvalPolicy: null },
    { name: "unknown string", approvalPolicy: "future-policy" },
    { name: "array", approvalPolicy: [] },
    { name: "empty object", approvalPolicy: {} },
    { name: "non-object granular value", approvalPolicy: { granular: "all" } },
  ])("rejects an invalid startup approval policy: $name", ({ approvalPolicy }) => {
    expect(runtimeConfigFixture({ approval_policy: approvalPolicy }).startupPermissions.approvalPolicy).toBeNull();
  });

  it.each([
    {
      name: "mixed booleans",
      granular: {
        sandbox_approval: true,
        rules: false,
        skill_approval: true,
        request_permissions: false,
        mcp_elicitations: true,
      },
      expected: {
        sandbox_approval: true,
        rules: false,
        skill_approval: true,
        request_permissions: false,
        mcp_elicitations: true,
      },
    },
    {
      name: "inverse booleans",
      granular: {
        sandbox_approval: false,
        rules: true,
        skill_approval: false,
        request_permissions: true,
        mcp_elicitations: false,
      },
      expected: {
        sandbox_approval: false,
        rules: true,
        skill_approval: false,
        request_permissions: true,
        mcp_elicitations: false,
      },
    },
    {
      name: "invalid values",
      granular: {
        sandbox_approval: 1,
        rules: "true",
        skill_approval: null,
        request_permissions: {},
        mcp_elicitations: [],
      },
      expected: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: false,
      },
    },
  ])("normalizes every granular approval policy flag for $name", ({ granular, expected }) => {
    expect(
      runtimeConfigFixture({
        approval_policy: { granular },
      }).startupPermissions.approvalPolicy,
    ).toEqual({
      granular: expected,
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
