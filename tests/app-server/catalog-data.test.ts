import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import { listHookData, listSkillCatalog } from "../../src/app-server/catalog/data";

describe("app-server catalog data adapters", () => {
  it("returns enabled skill options while preserving total app-server skill count", async () => {
    const client = {
      listSkills: vi.fn().mockResolvedValue({
        data: [
          {
            cwd: "/vault",
            skills: [
              { name: "enabled", description: "Enabled skill", path: "/skills/enabled", scope: "repo", enabled: true },
              { name: "disabled", description: "Disabled skill", path: "/skills/disabled", scope: "repo", enabled: false },
            ],
          },
        ],
      }),
    } as unknown as AppServerClient;

    await expect(listSkillCatalog(client, "/vault")).resolves.toMatchObject({
      skills: [{ name: "enabled", description: "Enabled skill", path: "/skills/enabled", enabled: true }],
      totalCount: 2,
    });
  });

  it("uses only hook rows for the requested cwd", async () => {
    const client = {
      listHooks: vi.fn().mockResolvedValue({
        data: [
          { cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] },
          { cwd: "/vault", hooks: [{ key: "vault" }], warnings: ["warn"], errors: [{ message: "err" }] },
        ],
      }),
    } as unknown as AppServerClient;

    await expect(listHookData(client, "/vault")).resolves.toMatchObject({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
    });
  });
});
