import { describe, expect, it } from "vitest";
import { FileSystemAdapter, type App } from "obsidian";

import {
  DEFAULT_SETTINGS,
  getVaultPath,
  normalizeSettings,
  settingsMatchNormalizedData,
  type CodexPanelSettings,
} from "../../src/settings/model";

describe("settings", () => {
  it("normalizes empty data", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("persists only panel-owned settings, not Codex runtime policy", () => {
    const storedData = {
      codexPath: "/usr/local/bin/codex",
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
      rewriteSelectionModel: "gpt-5.4-mini",
      rewriteSelectionEffort: "minimal",
      showToolbar: false,
      sendShortcut: "mod-enter",
      scrollThreadFromComposerEdges: true,
      archiveExportEnabled: true,
      archiveExportFolderTemplate: "Codex Archives/{{date}}",
      archiveExportFilenameTemplate: "{{title}} {{shortId}}.md",
      archiveExportTags: "codex, archive",
      model: "gpt-5.5",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      hooks: [{ event: "postToolUse" }],
      extraPanelState: { threadId: "thread-1" },
    };
    const normalized: CodexPanelSettings = {
      codexPath: "/usr/local/bin/codex",
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
      rewriteSelectionModel: "gpt-5.4-mini",
      rewriteSelectionEffort: "minimal",
      showToolbar: false,
      sendShortcut: "mod-enter",
      scrollThreadFromComposerEdges: true,
      archiveExportEnabled: true,
      archiveExportFolderTemplate: "Codex Archives/{{date}}",
      archiveExportFilenameTemplate: "{{title}} {{shortId}}.md",
      archiveExportTags: "codex, archive",
    };

    expect(normalizeSettings(storedData)).toEqual(normalized);
    expect(settingsMatchNormalizedData(storedData, normalized)).toBe(false);
  });

  it("uses the default codex path when the stored path is empty", () => {
    expect(normalizeSettings({ codexPath: "   " }).codexPath).toBe(DEFAULT_SETTINGS.codexPath);
  });

  it("detects when normalized settings need to be written back", () => {
    const settings = normalizeSettings({
      codexPath: "/usr/local/bin/codex",
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
      rewriteSelectionModel: "gpt-5.4-mini",
      rewriteSelectionEffort: "minimal",
      showToolbar: true,
      sendShortcut: "mod-enter",
      scrollThreadFromComposerEdges: true,
      archiveExportEnabled: true,
      archiveExportFolderTemplate: "Codex Archives",
      archiveExportFilenameTemplate: "{{date}} {{time}} {{title}} {{shortId}}.md",
      archiveExportTags: "codex, archive",
    });
    expect(settingsMatchNormalizedData({ ...settings }, settings)).toBe(true);
    expect(settingsMatchNormalizedData({ ...settings, extraPanelState: {} }, settings)).toBe(false);
    expect(settingsMatchNormalizedData({ ...settings, codexPath: "   " }, settings)).toBe(false);
  });

  it("normalizes thread naming helper preferences", () => {
    expect(normalizeSettings({ threadNamingModel: " gpt-5.4-mini ", threadNamingEffort: "low" })).toMatchObject({
      threadNamingModel: "gpt-5.4-mini",
      threadNamingEffort: "low",
    });
    expect(normalizeSettings({ threadNamingModel: 1, threadNamingEffort: "invalid" })).toMatchObject({
      threadNamingModel: DEFAULT_SETTINGS.threadNamingModel,
      threadNamingEffort: "invalid",
    });
  });

  it("normalizes selection rewrite helper preferences", () => {
    expect(normalizeSettings({ rewriteSelectionModel: " gpt-5.4-mini ", rewriteSelectionEffort: "minimal" })).toMatchObject({
      rewriteSelectionModel: "gpt-5.4-mini",
      rewriteSelectionEffort: "minimal",
    });
    expect(normalizeSettings({ rewriteSelectionModel: 1, rewriteSelectionEffort: "invalid" })).toMatchObject({
      rewriteSelectionModel: DEFAULT_SETTINGS.rewriteSelectionModel,
      rewriteSelectionEffort: "invalid",
    });
  });

  it("normalizes the send shortcut", () => {
    expect(normalizeSettings({ sendShortcut: "mod-enter" }).sendShortcut).toBe("mod-enter");
    expect(normalizeSettings({ sendShortcut: "invalid" }).sendShortcut).toBe(DEFAULT_SETTINGS.sendShortcut);
  });

  it("shows the chat toolbar by default", () => {
    expect(normalizeSettings({}).showToolbar).toBe(true);
    expect(normalizeSettings({ showToolbar: false }).showToolbar).toBe(false);
    expect(normalizeSettings({ showToolbar: "no" }).showToolbar).toBe(DEFAULT_SETTINGS.showToolbar);
  });

  it("normalizes composer edge scrolling", () => {
    expect(normalizeSettings({ scrollThreadFromComposerEdges: true }).scrollThreadFromComposerEdges).toBe(true);
    expect(normalizeSettings({ scrollThreadFromComposerEdges: "yes" }).scrollThreadFromComposerEdges).toBe(
      DEFAULT_SETTINGS.scrollThreadFromComposerEdges,
    );
  });

  it("normalizes archive export settings", () => {
    expect(
      normalizeSettings({
        archiveExportEnabled: true,
        archiveExportFolderTemplate: " Exports ",
        archiveExportFilenameTemplate: " {{title}}.md ",
        archiveExportTags: ' #codex, "archive" ',
      }),
    ).toMatchObject({
      archiveExportEnabled: true,
      archiveExportFolderTemplate: "Exports",
      archiveExportFilenameTemplate: "{{title}}.md",
      archiveExportTags: '#codex, "archive"',
    });
    expect(
      normalizeSettings({
        archiveExportEnabled: "yes",
        archiveExportFolderTemplate: 1,
        archiveExportFilenameTemplate: "   ",
        archiveExportTags: 1,
      }),
    ).toMatchObject({
      archiveExportEnabled: DEFAULT_SETTINGS.archiveExportEnabled,
      archiveExportFolderTemplate: DEFAULT_SETTINGS.archiveExportFolderTemplate,
      archiveExportFilenameTemplate: DEFAULT_SETTINGS.archiveExportFilenameTemplate,
      archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
    });
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
