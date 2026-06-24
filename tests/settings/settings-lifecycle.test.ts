import { describe, expect, it, vi } from "vitest";
import { listHookData } from "../../src/app-server/catalog";
import type { AppServerClient } from "../../src/app-server/connection/client";
import { createSettingsDynamicSectionLifecycle, transitionSettingsDynamicSectionLifecycle } from "../../src/settings/lifecycle";

describe("settings lifecycle", () => {
  it("tracks dynamic section lifecycle", () => {
    const idle = createSettingsDynamicSectionLifecycle();
    expect(idle).toEqual({ kind: "idle", status: "" });

    const loading = transitionSettingsDynamicSectionLifecycle(idle, { type: "started", status: "Loading hooks...", operationToken: 1 });
    expect(loading).toEqual({ kind: "loading", status: "Loading hooks...", operationToken: 1 });

    expect(transitionSettingsDynamicSectionLifecycle(loading, { type: "loaded", status: "Stale result.", operationToken: 0 })).toBe(
      loading,
    );

    const loaded = transitionSettingsDynamicSectionLifecycle(loading, { type: "loaded", status: "Loaded 1 hook.", operationToken: 1 });
    expect(loaded).toEqual({ kind: "loaded", status: "Loaded 1 hook.", operationToken: 1 });

    const failed = transitionSettingsDynamicSectionLifecycle(loaded, {
      type: "failed",
      status: "Could not load hooks.",
      operationToken: 1,
    });
    expect(failed).toEqual({ kind: "failed", status: "Could not load hooks.", operationToken: 1 });

    const laterLoaded = transitionSettingsDynamicSectionLifecycle(failed, { type: "loaded", status: "Loaded 2 hooks.", operationToken: 2 });
    expect(
      transitionSettingsDynamicSectionLifecycle(laterLoaded, { type: "started", status: "Loading old hooks...", operationToken: 1 }),
    ).toBe(laterLoaded);
    expect(transitionSettingsDynamicSectionLifecycle(laterLoaded, { type: "failed", status: "Late old failure.", operationToken: 1 })).toBe(
      laterLoaded,
    );

    expect(transitionSettingsDynamicSectionLifecycle(failed, { type: "reset" })).toEqual(idle);
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

    await expect(listHookData(client, "/vault")).resolves.toEqual({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
    });
  });

  it("does not fall back to unrelated hook rows", async () => {
    const client = {
      listHooks: vi.fn().mockResolvedValue({
        data: [{ cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] }],
      }),
    } as unknown as AppServerClient;

    await expect(listHookData(client, "/vault")).resolves.toEqual({
      hooks: [],
      warnings: [],
      errors: [],
    });
  });
});
