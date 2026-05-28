import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/client";
import {
  createSettingsDynamicSectionLifecycle,
  loadHookData,
  loadSettingsData,
  settingsDataRefreshLoading,
  transitionSettingsDynamicSectionLifecycle,
  transitionSettingsDataRefreshLifecycle,
} from "../../src/settings/data";

describe("settings data", () => {
  it("tracks settings data refresh lifecycle", () => {
    const idle = { kind: "idle" } as const;

    const loading = transitionSettingsDataRefreshLifecycle(idle, { type: "started" });
    expect(loading).toEqual({ kind: "loading" });
    expect(settingsDataRefreshLoading(loading)).toBe(true);
    expect(transitionSettingsDataRefreshLifecycle(loading, { type: "started" })).toBe(loading);

    const completed = transitionSettingsDataRefreshLifecycle(loading, { type: "completed", failedCount: 2 });
    expect(completed).toEqual({ kind: "completed", failedCount: 2 });
    expect(settingsDataRefreshLoading(completed)).toBe(false);
  });

  it("tracks dynamic section lifecycle", () => {
    const idle = createSettingsDynamicSectionLifecycle();
    expect(idle).toEqual({ kind: "idle", status: "" });

    const loading = transitionSettingsDynamicSectionLifecycle(idle, { type: "started", status: "Loading hooks...", operationId: 1 });
    expect(loading).toEqual({ kind: "loading", status: "Loading hooks...", operationId: 1 });

    expect(transitionSettingsDynamicSectionLifecycle(loading, { type: "loaded", status: "Stale result.", operationId: 0 })).toBe(loading);

    const loaded = transitionSettingsDynamicSectionLifecycle(loading, { type: "loaded", status: "Loaded 1 hook.", operationId: 1 });
    expect(loaded).toEqual({ kind: "loaded", status: "Loaded 1 hook.", operationId: 1 });

    const failed = transitionSettingsDynamicSectionLifecycle(loaded, { type: "failed", status: "Could not load hooks.", operationId: 1 });
    expect(failed).toEqual({ kind: "failed", status: "Could not load hooks.", operationId: 1 });

    const laterLoaded = transitionSettingsDynamicSectionLifecycle(failed, { type: "loaded", status: "Loaded 2 hooks.", operationId: 2 });
    expect(transitionSettingsDynamicSectionLifecycle(laterLoaded, { type: "failed", status: "Late old failure.", operationId: 1 })).toBe(
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
