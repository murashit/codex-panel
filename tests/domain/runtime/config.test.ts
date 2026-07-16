import { describe, expect, it } from "vitest";
import { emptyRuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../src/domain/runtime/config";

describe("runtime config", () => {
  it("clones nested permission policy state", () => {
    const config = {
      ...emptyRuntimeConfigSnapshot(),
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
    expect(cloned.startupPermissions).not.toBe(config.startupPermissions);
    expect(cloned.startupPermissions.approvalPolicy).not.toBe(config.startupPermissions.approvalPolicy);
    if (!cloned.startupPermissions.approvalPolicy || typeof cloned.startupPermissions.approvalPolicy === "string") {
      throw new Error("Expected granular approval policy");
    }
    expect(cloned.startupPermissions.approvalPolicy.granular).not.toBe(config.startupPermissions.approvalPolicy.granular);
  });
});
