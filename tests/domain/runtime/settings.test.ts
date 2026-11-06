import { describe, expect, it } from "vitest";
import {
  approvalsReviewerOrNull,
  autoReviewChangeRestriction,
  parseServiceTier,
  runtimeConfigOrDefault,
} from "../../../src/domain/runtime/settings";
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

  it("blocks only changes excluded by an explicit reviewer allow-list", () => {
    expect(autoReviewChangeRestriction(runtimeConfigFixture(), true)).toBeNull();
    expect(autoReviewChangeRestriction(runtimeConfigFixture({ requirementsUnavailable: true }), false)).toBeNull();
    expect(autoReviewChangeRestriction(runtimeConfigFixture({ allowedApprovalsReviewers: ["user"] }), true)).toBe(
      "Auto-review cannot be turned on under the current requirements.",
    );
    expect(autoReviewChangeRestriction(runtimeConfigFixture({ allowedApprovalsReviewers: ["auto_review"] }), false)).toBe(
      "Auto-review cannot be turned off under the current requirements.",
    );
    expect(autoReviewChangeRestriction(runtimeConfigFixture({ allowedApprovalsReviewers: ["guardian_subagent"] }), true)).toBeNull();
    expect(autoReviewChangeRestriction(runtimeConfigFixture({ allowedApprovalsReviewers: ["user", "auto_review"] }), true)).toBeNull();
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
