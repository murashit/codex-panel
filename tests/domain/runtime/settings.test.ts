import { describe, expect, it } from "vitest";
import { approvalsReviewerOrNull, parseServiceTier, runtimeConfigOrDefault } from "../../../src/domain/runtime/settings";
import { runtimeConfigFixture } from "../../support/runtime-config";

describe("runtime config", () => {
  it.each([
    ["user", "user"],
    ["auto_review", "auto_review"],
    ["guardian_subagent", "guardian_subagent"],
    ["unknown", null],
  ])("recognizes approvals reviewer %s", (value, expected) => {
    expect(approvalsReviewerOrNull(value)).toBe(expected);
  });

  it("preserves opaque service tier names and rejects absent values", () => {
    expect(parseServiceTier("catalog-tier")).toBe("catalog-tier");
    expect(parseServiceTier("default")).toBe("default");
    expect(parseServiceTier("")).toBeNull();
    expect(parseServiceTier(null)).toBeNull();
  });

  it("isolates permission snapshots from later source mutations", () => {
    const config = {
      ...runtimeConfigFixture(),
      startupPermissions: {
        activePermissionProfile: null,
        sandboxPolicy: null,
        approvalPolicy: {
          granular: {
            sandbox_approval: true,
            rules: false,
            skill_approval: true,
            request_permissions: false,
            mcp_elicitations: true,
          },
        },
      },
    };

    const cloned = runtimeConfigOrDefault(config);
    expect(cloned).toEqual(config);

    config.startupPermissions.approvalPolicy.granular.sandbox_approval = false;

    expect(cloned.startupPermissions.approvalPolicy).toMatchObject({
      granular: { sandbox_approval: true },
    });
  });
});
