import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/client";
import { loadHookData, loadSettingsData } from "../../src/settings/data";

describe("settings data", () => {
  it("uses only hook rows for the requested cwd", async () => {
    const client = {
      listHooks: vi.fn().mockResolvedValue({
        data: [
          { cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] },
          { cwd: "/vault", hooks: [{ key: "vault" }], warnings: ["warn"], errors: [{ message: "err" }] },
        ],
      }),
    } as unknown as AppServerClient;

    await expect(loadHookData(client, "/vault")).resolves.toMatchObject({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
      status: "Loaded 1 hook.",
    });
  });

  it("does not fall back to unrelated hook rows", async () => {
    const client = {
      listModels: vi.fn().mockResolvedValue({ data: [] }),
      listHooks: vi.fn().mockResolvedValue({
        data: [{ cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] }],
      }),
      listThreads: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as AppServerClient;

    const result = await loadSettingsData(client, "/vault");

    expect(result.hooks).toMatchObject({
      ok: true,
      data: { hooks: [], warnings: [], errors: [], status: "Loaded 0 hooks." },
      status: "Loaded 0 hooks.",
    });
  });
});
