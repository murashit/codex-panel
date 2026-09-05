import { describe, expect, it } from "vitest";
import { runtimeConfigOrDefault } from "../../../src/domain/runtime/config";
import { runtimeConfigFixture } from "../../support/runtime-config";

describe("runtime config", () => {
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
