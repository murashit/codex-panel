import { describe, expect, it } from "vitest";
import {
  createSettingsDynamicSectionLifecycle,
  settingsDynamicSectionFailed,
  settingsDynamicSectionLoaded,
  settingsDynamicSectionLoading,
} from "../../src/settings/lifecycle";

describe("settings lifecycle", () => {
  it("tracks dynamic section lifecycle", () => {
    const idle = createSettingsDynamicSectionLifecycle();
    expect(idle).toEqual({ kind: "idle", status: "" });

    const loading = settingsDynamicSectionLoading("Loading hooks...");
    expect(loading).toEqual({ kind: "loading", status: "Loading hooks..." });

    const loaded = settingsDynamicSectionLoaded("Loaded 1 hook.");
    expect(loaded).toEqual({ kind: "loaded", status: "Loaded 1 hook." });

    const failed = settingsDynamicSectionFailed("Could not load hooks.");
    expect(failed).toEqual({ kind: "failed", status: "Could not load hooks." });

    expect(createSettingsDynamicSectionLifecycle()).toEqual(idle);
  });
});
