import { describe, expect, it } from "vitest";
import { FileSystemAdapter, type App } from "obsidian";

import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData } from "../src/settings/model";

describe("settings", () => {
  it("normalizes empty data", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("drops unknown keys", () => {
    expect(
      normalizeSettings({
        codexPath: "/usr/local/bin/codex",
        threadNamingModel: "gpt-5.4-mini",
        threadNamingEffort: "low",
        sendShortcut: "mod-enter",
        extraPanelState: { threadId: "thread-1" },
      }),
    ).toEqual({
      codexPath: "/usr/local/bin/codex",
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
      sendShortcut: "mod-enter",
    });
  });

  it("uses the default codex path when the stored path is empty", () => {
    expect(normalizeSettings({ codexPath: "   " }).codexPath).toBe(DEFAULT_SETTINGS.codexPath);
  });

  it("detects when normalized settings need to be written back", () => {
    const settings = normalizeSettings({
      codexPath: "/usr/local/bin/codex",
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
      sendShortcut: "mod-enter",
    });
    expect(settingsMatchNormalizedData({ ...settings }, settings)).toBe(true);
    expect(settingsMatchNormalizedData({ ...settings, extraPanelState: {} }, settings)).toBe(false);
    expect(settingsMatchNormalizedData({ ...settings, codexPath: "   " }, settings)).toBe(false);
  });

  it("normalizes current naming runtime settings", () => {
    expect(normalizeSettings({ threadNamingModel: " gpt-5.4-mini ", threadNamingEffort: "low" })).toMatchObject({
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
    });
    expect(normalizeSettings({ threadNamingModel: 1, threadNamingEffort: "invalid" })).toMatchObject({
      threadNamingModel: DEFAULT_SETTINGS.threadNamingModel,
      threadNamingEffort: DEFAULT_SETTINGS.threadNamingEffort,
    });
  });

  it("normalizes the send shortcut", () => {
    expect(normalizeSettings({ sendShortcut: "mod-enter" }).sendShortcut).toBe("mod-enter");
    expect(normalizeSettings({ sendShortcut: "invalid" }).sendShortcut).toBe(DEFAULT_SETTINGS.sendShortcut);
  });

  it("requires a desktop filesystem vault path", () => {
    const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
    Object.defineProperty(adapter, "getBasePath", { value: () => "/vault" });

    expect(getVaultPath({ vault: { adapter } } as unknown as App)).toBe("/vault");
    expect(() => getVaultPath({ vault: { adapter: {} } } as unknown as App)).toThrow(
      "This plugin requires a desktop vault with a local basePath.",
    );
  });
});
