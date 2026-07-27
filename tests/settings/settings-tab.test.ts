// @vitest-environment jsdom

import { Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelMetadataFromCatalogModels } from "../../src/app-server/protocol/catalog";
import type { DeclarativeSettingDefinition, DeclarativeSettingDefinitionItem } from "../../src/settings/declarative-settings.compat";
import { DEFAULT_SETTINGS } from "../../src/settings/model";
import { CodexPanelSettingTab } from "../../src/settings/tab.obsidian";
import { notices } from "../mocks/obsidian";
import { deferred } from "../support/async";
import { installObsidianDomShims } from "../support/dom";
import {
  expectRequestTimes,
  flushPromises,
  hook,
  model,
  panelThread,
  requestMethods,
  type SettingsTabHostOptions,
  setSettingsShortLivedClientMock,
  settingsClient,
  settingsTabHost,
  useShortLivedClients,
} from "./test-support";

installObsidianDomShims();

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

setSettingsShortLivedClientMock(withShortLivedAppServerClientMock);

describe("settings tab", () => {
  beforeEach(() => {
    withShortLivedAppServerClientMock.mockReset();
    notices.length = 0;
  });

  it("exposes every persistent setting to Obsidian 1.13 search without loading dynamic data", () => {
    const tab = newSettingsTab();

    const definitions = tab.getSettingDefinitions();

    expect(withShortLivedAppServerClientMock).not.toHaveBeenCalled();
    expect(declarativeDefinitionNames(definitions)).toEqual([
      "Codex details",
      "Codex executable",
      "Show chat toolbar",
      "Panel helpers",
      "Automatic thread naming",
      "Selection rewrite",
      "Composer",
      "Send shortcut",
      "Scroll conversation from composer line edges",
      "Reference active file on send",
      "Attachment folder",
      "Thread archiving",
      "Save note by default",
      "Saved note folder",
      "Saved note filename",
      "Saved note tags",
      "Archived threads",
      "Archived threads content",
      "Codex hooks",
      "Codex hooks content",
    ]);
    expect(declarativeDefinitionByName(definitions, "Codex details")?.searchable).toBe(false);
  });

  it("routes every declarative control through the existing settings publication boundary", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const refreshChatViews = vi.fn();
    const refreshThreadsViews = vi.fn();
    const tab = newSettingsTab({ saveSettings, refreshChatViews, refreshThreadsViews });

    const changes = [
      ["showToolbar", false],
      ["sendShortcut", "mod-enter"],
      ["scrollThreadFromComposerEdges", true],
      ["referenceActiveNoteOnSend", true],
      ["archiveExportEnabled", true],
    ] as const;
    for (const [key, value] of changes) {
      await tab.setControlValue(key, value);
      expect(tab.getControlValue(key)).toBe(value);
      expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: value }));
    }

    expect(saveSettings).toHaveBeenCalledTimes(changes.length);
    expect(refreshChatViews).toHaveBeenCalledTimes(2);
    expect(refreshThreadsViews).toHaveBeenCalledOnce();
  });

  it("ignores invalid declarative control values and rejects unknown keys", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    await tab.setControlValue("showToolbar", "false");
    await tab.setControlValue("sendShortcut", "invalid");
    await tab.setControlValue("scrollThreadFromComposerEdges", null);
    await tab.setControlValue("referenceActiveNoteOnSend", 1);
    await tab.setControlValue("archiveExportEnabled", undefined);

    expect(saveSettings).not.toHaveBeenCalled();
    expect(tab.getControlValue("unknown")).toBeUndefined();
    await expect(tab.setControlValue("unknown", true)).rejects.toThrow("Unknown declarative setting key: unknown");
  });

  it("publishes model and effort changes from a representative declarative helper renderer", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useShortLivedClients(settingsClient());
    const tab = newSettingsTab({
      saveSettings,
      modelsSnapshot: modelMetadataFromCatalogModels([model("gpt-5.5", false, false, ["extreme"])]),
    });
    const helper = declarativeDefinitionByName(tab.getSettingDefinitions(), "Automatic thread naming");
    const container = renderDeclarativeDefinition(helper, "Automatic thread naming");

    const modelSelect = container.querySelectorAll("select")[0];
    if (!modelSelect) throw new Error("Missing declarative helper model dropdown");
    modelSelect.value = "gpt-5.5";
    modelSelect.dispatchEvent(new Event("change"));
    await flushPromises();

    const effortSelect = container.querySelectorAll("select")[1];
    if (!effortSelect) throw new Error("Missing declarative helper effort dropdown");
    effortSelect.value = "extreme";
    effortSelect.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadNamingModel: "gpt-5.5" }));
    expect(saveSettings).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadNamingEffort: "extreme" }));
  });

  it("normalizes and publishes a representative declarative archive text field", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useShortLivedClients(settingsClient());
    const tab = newSettingsTab({ saveSettings });
    const filename = declarativeDefinitionByName(tab.getSettingDefinitions(), "Saved note filename");
    const container = renderDeclarativeDefinition(filename, "Saved note filename");
    const input = container.querySelector("input");
    if (!input) throw new Error("Missing declarative archive filename input");

    input.value = "  {{date}} {{title}}.md  ";
    input.dispatchEvent(new Event("blur"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ archiveExportFilenameTemplate: "{{date}} {{title}}.md" }));
    expect(input.value).toBe("{{date}} {{title}}.md");
  });

  it("restores a thread through the declarative archived-section callback", async () => {
    const client = settingsClient();
    useShortLivedClients(client);
    const tab = newSettingsTab({
      archivedSnapshot: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })],
    });
    const archived = declarativeDefinitionByName(tab.getSettingDefinitions(), "Archived threads content");
    const container = renderDeclarativeDefinition(archived, "Archived threads content");
    const restore = container.querySelector<HTMLElement>('[aria-label="Restore thread"]');
    if (!restore) throw new Error("Missing declarative archived-thread restore action");

    restore.click();
    await flushPromises();

    expect(client.request).toHaveBeenCalledWith("thread/unarchive", { threadId: "thread-archived" });
  });

  it("preserves an active declarative text island while dynamic sections refresh", async () => {
    const client = settingsClient();
    useShortLivedClients(client);
    const tab = newSettingsTab();
    const executable = declarativeDefinitionByName(tab.getSettingDefinitions(), "Codex executable");
    if (!executable?.render) throw new Error("Missing declarative Codex executable renderer");
    const container = document.createElement("div");

    executable.render(new Setting(container), {} as never);
    const input = container.querySelector("input");
    if (!input) throw new Error("Missing declarative Codex executable input");
    input.focus();
    input.value = "/draft/codex";

    await flushPromises();

    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("/draft/codex");
  });

  it("rolls back a declarative text island after publication fails", async () => {
    const client = settingsClient();
    useShortLivedClients(client);
    const tab = newSettingsTab({ saveSettings: vi.fn().mockRejectedValue(new Error("disk full")) });
    const executable = declarativeDefinitionByName(tab.getSettingDefinitions(), "Codex executable");
    if (!executable?.render) throw new Error("Missing declarative Codex executable renderer");
    const container = document.createElement("div");

    executable.render(new Setting(container), {} as never);
    const input = container.querySelector("input");
    if (!input) throw new Error("Missing declarative Codex executable input");
    input.value = "/failed/codex";
    input.dispatchEvent(new Event("blur"));

    await flushPromises();

    expect(container.querySelector("input")?.value).toBe(DEFAULT_SETTINGS.codexPath);
    expect(notices).toContain("Could not apply Codex Panel settings: disk full");
  });

  it("auto-loads dynamic sections once and keeps one global refresh button", async () => {
    const client = settingsClient();
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    useShortLivedClients(client);
    const tab = newSettingsTab({ fetchModels });

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expectRequestTimes(client, "hooks/list", 1);

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(buttonLabels(tab)).toContain("Refresh Codex details");
    expect(settingNames(tab)).toContain("Codex hooks");
    expect(settingNames(tab)).toContain("Archived threads");
  });

  it("saves the send shortcut setting", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const shortcut = selectForSetting(tab, "Send shortcut");
    if (!shortcut) throw new Error("Missing send shortcut dropdown");

    shortcut.value = "mod-enter";
    shortcut.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it("saves the toolbar visibility setting and refreshes open panels", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const refreshChatViews = vi.fn();
    const tab = newSettingsTab({ saveSettings, refreshChatViews });

    tab.display();
    const toggle = inputForSetting(tab, "Show chat toolbar");
    if (!toggle) throw new Error("Missing toolbar visibility toggle");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(refreshChatViews).toHaveBeenCalledOnce();
  });

  it("finishes a pending settings save without remounting a hidden tab", async () => {
    const save = deferred<void>();
    const saveSettings = vi.fn(() => save.promise);
    const refreshChatViews = vi.fn();
    const tab = newSettingsTab({ saveSettings, refreshChatViews });

    tab.display();
    const toggle = inputForSetting(tab, "Show chat toolbar");
    if (!toggle) throw new Error("Missing toolbar visibility toggle");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await Promise.resolve();

    tab.hide();
    expect(tab.containerEl.children).toHaveLength(0);

    save.resolve(undefined);
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(refreshChatViews).toHaveBeenCalledOnce();
    expect(tab.containerEl.children).toHaveLength(0);
  });

  it("binds the replacement executable data source when a hidden tab is shown again", async () => {
    const save = deferred<void>();
    const observeModels = vi.fn(() => vi.fn());
    useShortLivedClients(settingsClient(), settingsClient());
    const host = settingsTabHost({
      saveSettings: vi.fn(() => save.promise),
      observeModels,
    });
    const tab = new CodexPanelSettingTab({} as never, {} as never, host);

    tab.display();
    const codexInput = inputForSetting(tab, "Codex executable");
    if (!codexInput) throw new Error("Missing Codex executable input");
    codexInput.value = "/opt/codex-next";
    codexInput.dispatchEvent(new FocusEvent("blur"));
    await Promise.resolve();
    tab.hide();

    save.resolve(undefined);
    await flushPromises();
    tab.display();

    expect(host.settings.codexPath).toBe("/opt/codex-next");
    expect(observeModels).toHaveBeenCalledTimes(2);
  });

  it("serializes overlapping settings saves", async () => {
    const firstSave = deferred<void>();
    const saveSettings = vi.fn().mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const shortcut = selectForSetting(tab, "Send shortcut");
    const toggle = inputForSetting(tab, "Reference active file on send");
    if (!shortcut || !toggle) throw new Error("Missing settings controls");

    shortcut.value = "mod-enter";
    shortcut.dispatchEvent(new Event("change"));
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledOnce();

    firstSave.resolve(undefined);
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest native control value while an earlier save is pending", async () => {
    const firstSave = deferred<void>();
    const saveSettings = vi.fn().mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = inputForSetting(tab, "Show chat toolbar");
    if (!toggle) throw new Error("Missing toolbar visibility toggle");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(toggle.checked).toBe(true);
    expect(saveSettings).toHaveBeenCalledOnce();

    firstSave.resolve(undefined);
    await flushPromises();

    expect(inputForSetting(tab, "Show chat toolbar")?.checked).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it("rolls back only the failed mutation after an earlier queued save succeeds", async () => {
    const saveSettings = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("disk full"));
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const shortcut = selectForSetting(tab, "Send shortcut");
    const toggle = inputForSetting(tab, "Reference active file on send");
    if (!shortcut || !toggle) throw new Error("Missing settings controls");

    shortcut.value = "mod-enter";
    shortcut.dispatchEvent(new Event("change"));
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(selectForSetting(tab, "Send shortcut")?.value).toBe("mod-enter");
    expect(inputForSetting(tab, "Reference active file on send")?.checked).toBe(false);
    expect(notices).toContain("Could not apply Codex Panel settings: disk full");
  });

  it("saves archive export settings", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = inputForSetting(tab, "Save note by default");
    if (!toggle) throw new Error("Missing archive export toggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    const folder = inputForSetting(tab, "Saved note folder");
    if (!folder) throw new Error("Missing archive export folder input");
    folder.value = "Saved Threads";
    folder.dispatchEvent(new Event("blur"));
    await flushPromises();

    const filename = inputForSetting(tab, "Saved note filename");
    if (!filename) throw new Error("Missing archive export filename input");
    filename.value = "{{date}} {{title}}.md";
    filename.dispatchEvent(new Event("blur"));
    await flushPromises();

    const tags = inputForSetting(tab, "Saved note tags");
    if (!tags) throw new Error("Missing archive export tags input");
    tags.value = "codex, archive";
    tags.dispatchEvent(new Event("blur"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledTimes(4);
  });

  it("restores default archive export templates when cleared", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();

    const folder = inputForSetting(tab, "Saved note folder");
    if (!folder) throw new Error("Missing archive export folder input");
    folder.value = "   ";
    folder.dispatchEvent(new Event("blur"));
    await flushPromises();

    expect(inputForSetting(tab, "Saved note folder")?.value).toBe(DEFAULT_SETTINGS.archiveExportFolderTemplate);

    const filename = inputForSetting(tab, "Saved note filename");
    if (!filename) throw new Error("Missing archive export filename input");
    filename.value = "   ";
    filename.dispatchEvent(new Event("blur"));
    await flushPromises();

    expect(inputForSetting(tab, "Saved note filename")?.value).toBe(DEFAULT_SETTINGS.archiveExportFilenameTemplate);
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it("refreshes models, hooks, and archived threads from the global refresh button", async () => {
    const firstClient = settingsClient({ models: [model("gpt-5.4")] });
    const secondClient = settingsClient({ models: [model("gpt-5.5")] });
    useShortLivedClients(firstClient, secondClient);
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.4")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New", archived: true })]);
    const tab = newSettingsTab({ fetchModels, refreshModels, refreshArchived });

    tab.display();
    await flushPromises();
    clickButtonByLabel(tab, "Refresh Codex details");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(fetchModels).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledOnce();
    expect(refreshArchived).toHaveBeenCalledTimes(2);
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
    expect(tab.containerEl.textContent).toContain("New");
    expect(tab.containerEl.textContent).not.toContain("Old");
  });

  it("clears dynamic sections when the Codex executable changes", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const refreshChatViews = vi.fn();
    const oldClient = settingsClient({
      models: [model("gpt-old")],
      hooks: [hook({ key: "hook-old", command: "old hook", currentHash: "oldhash" })],
    });
    const newClient = settingsClient({
      models: [model("gpt-new")],
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    useShortLivedClients(oldClient, newClient);
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-old")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-new")]));
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old archived", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New archived", archived: true })]);
    const tab = newSettingsTab({ saveSettings, refreshChatViews, fetchModels, refreshModels, refreshArchived });

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("gpt-old");
    expect(tab.containerEl.textContent).toContain("Old archived");

    const codexInput = inputForSetting(tab, "Codex executable");
    if (!codexInput) throw new Error("Missing Codex executable input");
    codexInput.value = "/opt/codex";
    codexInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flushPromises();

    expect(saveSettings).not.toHaveBeenCalled();
    expect(refreshChatViews).not.toHaveBeenCalled();

    codexInput.dispatchEvent(new FocusEvent("blur"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(refreshChatViews).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(tab.containerEl.textContent).not.toContain("gpt-old");
    expect(tab.containerEl.textContent).not.toContain("Old archived");

    clickButtonByLabel(tab, "Refresh Codex details");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(withShortLivedAppServerClientMock.mock.calls[1]?.[0]).toBe("/opt/codex");
    expect(tab.containerEl.textContent).toContain("gpt-new");
    expect(tab.containerEl.textContent).toContain("New archived");
  });

  it("publishes a Codex executable change only after persistence", async () => {
    const save = deferred<void>();
    const saveSettings = vi.fn(() => save.promise);
    const host = settingsTabHost({ saveSettings });
    const tab = new CodexPanelSettingTab({} as never, {} as never, host);

    tab.display();
    const codexInput = inputForSetting(tab, "Codex executable");
    if (!codexInput) throw new Error("Missing Codex executable input");
    codexInput.value = "/opt/codex-next";
    codexInput.dispatchEvent(new FocusEvent("blur"));
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "/opt/codex-next" }));
    expect(host.settings.codexPath).toBe("codex");

    save.resolve(undefined);
    await flushPromises();

    expect(host.settings.codexPath).toBe("/opt/codex-next");
  });

  it("does not publish a Codex executable candidate when persistence fails", async () => {
    const host = settingsTabHost({ saveSettings: vi.fn().mockRejectedValue(new Error("disk full")) });
    const tab = new CodexPanelSettingTab({} as never, {} as never, host);

    tab.display();
    const codexInput = inputForSetting(tab, "Codex executable");
    if (!codexInput) throw new Error("Missing Codex executable input");
    codexInput.value = "/opt/codex-next";
    codexInput.dispatchEvent(new FocusEvent("blur"));
    await flushPromises();

    expect(host.settings.codexPath).toBe("codex");
    expect(inputForSetting(tab, "Codex executable")?.value).toBe("codex");
  });

  it("subscribes model updates only while the settings tab is displayed", () => {
    useShortLivedClients(settingsClient());
    const unsubscribe = vi.fn();
    const observeModels = vi.fn(() => unsubscribe);
    const tab = newSettingsTab({ observeModels });

    expect(observeModels).not.toHaveBeenCalled();

    tab.display();
    tab.hide();
    tab.display();

    expect(observeModels).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("uses cached models initially and publishes refreshed models", async () => {
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    const client = settingsClient({ models: [model("gpt-5.5")] });
    useShortLivedClients(client);
    const tab = newSettingsTab({ modelsSnapshot: modelMetadataFromCatalogModels([model("gpt-cached")]), fetchModels });

    tab.display();

    expect(tab.containerEl.textContent).toContain("gpt-cached");

    await flushPromises();

    expect(fetchModels).toHaveBeenCalledOnce();
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
  });

  it("replaces stale cached model options with an empty successful refresh while preserving saved values", async () => {
    const fetchModels = vi.fn().mockResolvedValue([]);
    const client = settingsClient({ models: [] });
    useShortLivedClients(client);
    const tab = newSettingsTab({
      modelsSnapshot: modelMetadataFromCatalogModels([model("gpt-cached")]),
      fetchModels,
      settings: {
        threadNamingModel: "gpt-saved",
        rewriteSelectionModel: "gpt-cached",
      },
    });

    tab.display();

    expect(selectOptions(tab, "Automatic thread naming")).toEqual(["Codex default", "gpt-saved (saved)", "gpt-cached"]);
    expect(selectOptions(tab, "Selection rewrite")).toEqual(["Codex default", "gpt-cached"]);

    await flushPromises();

    expect(fetchModels).toHaveBeenCalledOnce();
    expect(selectOptions(tab, "Automatic thread naming")).toEqual(["Codex default", "gpt-saved (saved)"]);
    expect(selectOptions(tab, "Selection rewrite")).toEqual(["Codex default", "gpt-cached (saved)"]);
  });

  it("uses model-provided reasoning efforts in helper settings while preserving saved unknown values", async () => {
    const tab = newSettingsTab({
      modelsSnapshot: modelMetadataFromCatalogModels([model("gpt-5.5", false, false, ["extreme"])]),
      settings: {
        threadNamingModel: "gpt-5.5",
        threadNamingEffort: "saved-custom-effort",
        rewriteSelectionModel: "gpt-5.5",
        rewriteSelectionEffort: "extreme",
      },
    });

    tab.display();

    expect(selectOptions(tab, "Automatic thread naming", 1)).toEqual(["Codex default", "saved-custom-effort (saved)", "extreme"]);
    expect(selectOptions(tab, "Selection rewrite", 1)).toEqual(["Codex default", "extreme"]);
  });

  it("keeps successful sections when one dynamic sections request fails", async () => {
    const client = settingsClient({
      models: [model("gpt-5.4")],
      hooksError: new Error("hooks unavailable"),
    });
    useShortLivedClients(client);
    const tab = newSettingsTab({ archivedThreads: [panelThread({ preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("Could not load hooks: hooks unavailable");
    expect(tab.containerEl.textContent).toContain("Archived thread");
    expect(notices).toEqual(["Could not refresh all Codex details."]);
  });

  it("renders archived threads and hooks as dynamic setting rows", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-1", command: "node hook.js", currentHash: "abc123", trustStatus: "untrusted" })],
    });
    useShortLivedClients(client);
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__hook-list .codex-panel-settings__hook-row")).toHaveLength(1);
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .codex-panel-settings__archived-row")).toHaveLength(1);
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-list")?.textContent).not.toContain("abc123");
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-list")?.textContent).toContain("untrusted · inactive");
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list")?.textContent).toContain("Archived thread");
    expect(buttonTexts(tab)).toContain("Trust");
    expect(buttonLabels(tab)).toContain("Restore thread");
    expect(buttonLabels(tab)).toContain("Delete thread");
  });

  it("confirms archived thread deletion inline and cancels from outside clicks", async () => {
    const client = settingsClient();
    useShortLivedClients(client);
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete thread");

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();

    tab.containerEl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).toBeNull();
    expect(requestMethods(client)).not.toContain("thread/delete");
  });

  it("preserves an in-progress Codex executable edit while dynamic sections update", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const client = settingsClient();
    useShortLivedClients(client);
    const tab = newSettingsTab({
      saveSettings,
      archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })],
    });

    tab.display();
    document.body.appendChild(tab.containerEl);
    await flushPromises();

    const codexInput = inputForSetting(tab, "Codex executable");
    const archiveToggle = inputForSetting(tab, "Save note by default");
    if (!codexInput || !archiveToggle) throw new Error("Missing settings controls");

    codexInput.focus();
    codexInput.value = "/opt/codex-draft";
    codexInput.setSelectionRange(5, 10);

    archiveToggle.checked = true;
    archiveToggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(inputForSetting(tab, "Codex executable")?.value).toBe("/opt/codex-draft");
    expect(document.activeElement).toBe(inputForSetting(tab, "Codex executable"));
    expect(inputForSetting(tab, "Codex executable")?.selectionStart).toBe(5);
    expect(inputForSetting(tab, "Codex executable")?.selectionEnd).toBe(10);

    clickButtonByLabel(tab, "Delete thread");

    expect(inputForSetting(tab, "Codex executable")?.value).toBe("/opt/codex-draft");
    expect(document.activeElement).toBe(inputForSetting(tab, "Codex executable"));
    expect(inputForSetting(tab, "Codex executable")?.selectionStart).toBe(5);
    expect(inputForSetting(tab, "Codex executable")?.selectionEnd).toBe(10);
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();
    tab.containerEl.remove();
  });

  it("permanently deletes an archived thread from the confirmed settings row", async () => {
    const client = settingsClient();
    useShortLivedClients(client);
    const deleteRequest = deferred<undefined>();
    client.requestHandlers["thread/delete"]?.mockReturnValue(deleteRequest.promise);
    let publishArchivedThreads = (): void => undefined;
    const tab = newSettingsTab({
      archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })],
      observeArchived: (listener) => {
        publishArchivedThreads = () => {
          listener({ value: [], error: null, isFetching: false });
        };
        return () => undefined;
      },
      applyThreadFact: (fact) => {
        if (fact.type === "thread-deleted") publishArchivedThreads();
      },
    });

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete thread");
    pointerDownButtonByLabel(tab, "Delete thread");
    clickButtonByLabel(tab, "Delete thread");
    await flushPromises();

    expect(client.request).toHaveBeenCalledWith("thread/delete", { threadId: "thread-archived" }, {});
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list")).not.toBeNull();

    deleteRequest.resolve(undefined);
    await flushPromises();

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list .codex-panel-settings__status-row")).not.toBeNull();
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .codex-panel-settings__archived-row")).toHaveLength(0);
  });
});

function newSettingsTab(options: SettingsTabHostOptions = {}): CodexPanelSettingTab {
  return new CodexPanelSettingTab({} as never, {} as never, settingsTabHost(options));
}

function declarativeDefinitionNames(definitions: DeclarativeSettingDefinitionItem[]): string[] {
  return definitions.flatMap((definition) => {
    if ("type" in definition) {
      return [...(definition.heading ? [definition.heading] : []), ...declarativeDefinitionNames(definition.items ?? [])];
    }
    return [definition.name];
  });
}

function declarativeDefinitionByName(
  definitions: DeclarativeSettingDefinitionItem[],
  name: string,
): DeclarativeSettingDefinition | undefined {
  for (const definition of definitions) {
    if ("type" in definition) {
      const nested = declarativeDefinitionByName(definition.items ?? [], name);
      if (nested) return nested;
    } else if (definition.name === name) {
      return definition;
    }
  }
  return undefined;
}

function renderDeclarativeDefinition(definition: DeclarativeSettingDefinition | undefined, name: string): HTMLDivElement {
  if (!definition?.render) throw new Error(`Missing declarative ${name} renderer`);
  const container = document.createElement("div");
  definition.render(new Setting(container), {} as never);
  return container;
}

function settingNames(tab: CodexPanelSettingTab): string[] {
  return Array.from(settingsSectionRoots(tab)).flatMap((element) => {
    if (element.classList.contains("codex-panel-settings__header")) return [];
    if (element.classList.contains("setting-item")) {
      return [element.querySelector(".setting-item-name")?.textContent ?? ""];
    }
    if (element.classList.contains("codex-panel-settings__section")) {
      return settingsGroupNames(element);
    }
    if (element.classList.contains("codex-panel-settings__dynamic-section")) {
      return settingsGroupNames(element);
    }
    return [];
  });
}

function settingsGroupNames(element: Element): string[] {
  const names = Array.from(element.querySelectorAll(":scope > .setting-item-heading")).map((setting) => {
    return setting.querySelector(".setting-item-name")?.textContent ?? "";
  });
  names.push(
    ...Array.from(element.querySelectorAll(":scope > .setting-items:not(.codex-panel-settings__dynamic-list) > .setting-item")).flatMap(
      (setting) => {
        return [setting.querySelector(".setting-item-name")?.textContent ?? ""];
      },
    ),
  );
  return names;
}

function settingsSectionRoots(tab: CodexPanelSettingTab): Element[] {
  return Array.from(tab.containerEl.children);
}

function buttonTexts(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll("button")).map((element) => element.textContent);
}

function buttonLabels(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll<HTMLElement>("button, [aria-label]")).map((element) => element.ariaLabel ?? "");
}

function clickButtonByLabel(tab: CodexPanelSettingTab, label: string): void {
  buttonByLabel(tab, label).click();
}

function pointerDownButtonByLabel(tab: CodexPanelSettingTab, label: string): void {
  buttonByLabel(tab, label).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}

function buttonByLabel(tab: CodexPanelSettingTab, label: string): HTMLElement {
  const button = Array.from(tab.containerEl.querySelectorAll<HTMLElement>("button, [aria-label]")).find(
    (element) => element.ariaLabel === label,
  );
  if (!button) throw new Error(`Could not find button: ${label}`);
  return button;
}

function inputForSetting(tab: CodexPanelSettingTab, name: string): HTMLInputElement | null {
  return settingElement(tab, name)?.querySelector("input") ?? null;
}

function settingElement(tab: CodexPanelSettingTab, name: string): Element | null {
  return (
    Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
      (element) => element.querySelector(".setting-item-name")?.textContent === name,
    ) ?? null
  );
}

function selectForSetting(tab: CodexPanelSettingTab, name: string): HTMLSelectElement | null {
  return settingElement(tab, name)?.querySelector("select") ?? null;
}

function selectOptions(tab: CodexPanelSettingTab, name: string, index = 0): string[] {
  const select = settingElement(tab, name)?.querySelectorAll<HTMLSelectElement>("select")[index] ?? null;
  if (!select) throw new Error(`Missing select: ${name}`);
  return Array.from(select.options).map((option) => option.textContent);
}
