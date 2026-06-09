import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/client";
import { listPanelHookData, listPanelSkillCatalog, listPanelThreads } from "../../src/app-server/panel-data";

describe("panel app-server data loaders", () => {
  it("maps listed threads to panel threads with archive state", async () => {
    const listThreads = vi.fn().mockResolvedValue({
      data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20 }],
    });
    const client = {
      listThreads,
    } as unknown as AppServerClient;

    await expect(listPanelThreads(client, "/vault", { archived: true })).resolves.toEqual([
      { id: "thread-1", preview: "Preview", name: null, archived: true, createdAt: 10, updatedAt: 20 },
    ]);
    expect(listThreads).toHaveBeenCalledWith("/vault", true);
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

    await expect(listPanelHookData(client, "/vault")).resolves.toMatchObject({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
    });
  });

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

    await expect(listPanelSkillCatalog(client, "/vault")).resolves.toMatchObject({
      skills: [{ name: "enabled", description: "Enabled skill", path: "/skills/enabled", enabled: true }],
      totalCount: 2,
    });
  });
});
