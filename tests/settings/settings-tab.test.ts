// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import type { ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import { modelMetadataFromCatalogModels } from "../../src/app-server/protocol/catalog";
import { SettingsDynamicDataController, type SettingsDynamicDataSnapshot } from "../../src/settings/dynamic-data-controller";
import { CodexPanelSettingTab } from "../../src/settings/tab";
import type { CodexPanelSettingTabHost } from "../../src/settings/tab";
import type { Thread } from "../../src/domain/threads/model";
import { archivedThreadDisplayTitle } from "../../src/settings/archived-thread-title";
import { notices } from "../mocks/obsidian";
import { deferred } from "../support/async";
import { installObsidianDomShims } from "../support/dom";

installObsidianDomShims();

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

describe("settings tab", () => {
  beforeEach(() => {
    withShortLivedAppServerClientMock.mockReset();
    notices.length = 0;
  });

  it("uses a placeholder for threads without a useful title", () => {
    expect(archivedThreadDisplayTitle(panelThread({ name: null, preview: "" }))).toBe("Untitled archived thread");
    expect(archivedThreadDisplayTitle(panelThread({ name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781" }))).toBe("Untitled archived thread");
  });

  it("normalizes and truncates archived thread titles", () => {
    expect(archivedThreadDisplayTitle(panelThread({ preview: "A title\nwith   extra\tspace" }))).toBe("A title with extra space");

    const title = archivedThreadDisplayTitle(panelThread({ preview: "x".repeat(120) }));
    expect(title).toHaveLength(96);
    expect(title.endsWith("...")).toBe(true);
  });

  it("auto-loads settings data once and keeps one global refresh button", async () => {
    const client = settingsClient();
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ fetchModels });

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(client.listModels).not.toHaveBeenCalled();
    expect(client.listHooks).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledWith("/vault", { archived: true, cursor: null, limit: 100 });

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(buttonLabels(tab)).toContain("Refresh Codex data");
    expect(buttonTexts(tab)).not.toContain("Refresh Codex data");
    expect(buttonTexts(tab)).not.toContain("Load models");
    expect(buttonTexts(tab)).not.toContain("Load hooks");
    expect(buttonTexts(tab)).not.toContain("Load archive list");
    expect(tab.containerEl.querySelector(".codex-panel-settings__header button")?.getAttribute("data-icon")).toBe("refresh-cw");
    expect(tab.containerEl.querySelector("h2")).toBeNull();
    expect(settingNames(tab)).toEqual([
      "Codex executable",
      "Show chat toolbar",
      "Composer",
      "Send shortcut",
      "Scroll thread from composer edges",
      "Codex helpers",
      "Automatic thread naming",
      "Selection rewrite",
      "Thread archiving",
      "Hook status",
    ]);
  });

  it("saves the send shortcut setting and warns about Obsidian hotkeys", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    expect(inputForSetting(tab, "Codex executable")?.getAttribute("aria-label")).toBeNull();
    const shortcut = selectForSetting(tab, "Send shortcut");
    if (!shortcut) throw new Error("Missing send shortcut dropdown");

    shortcut.value = "mod-enter";
    shortcut.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(settingDesc(tab, "Send shortcut")).toContain("Obsidian hotkeys");
    expect(tab.containerEl.querySelector(".codex-panel-settings__section-status")?.textContent ?? "").not.toContain("Obsidian hotkeys");
  });

  it("saves the toolbar visibility setting and refreshes open panels", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const refreshOpenViews = vi.fn();
    const tab = newSettingsTab({ saveSettings, refreshOpenViews });

    tab.display();
    const toggle = inputForSetting(tab, "Show chat toolbar");
    if (!toggle) throw new Error("Missing toolbar visibility toggle");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(refreshOpenViews).toHaveBeenCalledOnce();
    expect(settingDesc(tab, "Show chat toolbar")).toContain("Slash commands");
  });

  it("saves the composer edge scroll setting", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = inputForSetting(tab, "Scroll thread from composer edges");
    if (!toggle) throw new Error("Missing composer edge scroll toggle");

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(settingDesc(tab, "Scroll thread from composer edges")).toContain("Up/Ctrl+P");
  });

  it("saves archive export settings", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = inputForSetting(tab, "Save note by default");
    const folder = inputForSetting(tab, "Saved note folder");
    const filename = inputForSetting(tab, "Saved note filename");
    const tags = inputForSetting(tab, "Saved note tags");
    if (!toggle || !folder || !filename || !tags) throw new Error("Missing archive export controls");
    expect(folder.getAttribute("aria-label")).toBeNull();
    expect(filename.getAttribute("aria-label")).toBeNull();
    expect(tags.getAttribute("aria-label")).toBeNull();
    expect(toggle.parentElement?.classList.contains("checkbox-container")).toBe(true);
    expect(folder.type).toBe("text");
    expect(filename.type).toBe("text");
    expect(tags.type).toBe("text");

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    folder.value = "Saved Threads";
    folder.dispatchEvent(new Event("change"));
    filename.value = "{{date}} {{title}}.md";
    filename.dispatchEvent(new Event("change"));
    tags.value = "codex, archive";
    tags.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledTimes(4);
    expect(tab.containerEl.textContent).toContain("title, thread_id, created, and optional tags");
    expect(settingDesc(tab, "Save note by default")).toContain("default archive action");
    expect(settingDesc(tab, "Save note by default")).toContain("If saving fails");
    expect(settingDesc(tab, "Saved note tags")).toContain("Leave empty to omit tags");
  });

  it("refreshes models, hooks, and archived threads from the global refresh button", async () => {
    const firstClient = settingsClient({ models: [model("gpt-5.4")], threads: [appServerThread({ id: "thread-old", preview: "Old" })] });
    const secondClient = settingsClient({
      models: [model("gpt-5.5")],
      threads: [appServerThread({ id: "thread-new", preview: "New" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(firstClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(secondClient),
      );
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.4")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    const tab = newSettingsTab({ fetchModels, refreshModels });

    tab.display();
    await flushPromises();
    clickButtonByLabel(tab, "Refresh Codex data");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(fetchModels).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledOnce();
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
    expect(tab.containerEl.textContent).toContain("New");
    expect(tab.containerEl.textContent).not.toContain("Old");
  });

  it("clears dynamic settings data when the Codex executable changes", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const notifyContextChanged = vi.fn();
    const refreshOpenViews = vi.fn();
    const oldClient = settingsClient({
      models: [model("gpt-old")],
      hooks: [hook({ key: "hook-old", command: "old hook", currentHash: "oldhash" })],
      threads: [appServerThread({ id: "thread-old", preview: "Old archived" })],
    });
    const newClient = settingsClient({
      models: [model("gpt-new")],
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
      threads: [appServerThread({ id: "thread-new", preview: "New archived" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(oldClient))
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(newClient));
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-old")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-new")]));
    const tab = newSettingsTab({ saveSettings, notifyContextChanged, refreshOpenViews, fetchModels, refreshModels });

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("gpt-old");
    expect(tab.containerEl.textContent).toContain("Old archived");

    const codexInput = inputForSetting(tab, "Codex executable");
    if (!codexInput) throw new Error("Missing Codex executable input");
    codexInput.value = "/opt/codex";
    codexInput.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).not.toHaveBeenCalled();
    expect(notifyContextChanged).not.toHaveBeenCalled();
    expect(refreshOpenViews).not.toHaveBeenCalled();

    codexInput.dispatchEvent(new FocusEvent("blur"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(notifyContextChanged).toHaveBeenCalledOnce();
    expect(refreshOpenViews).toHaveBeenCalledOnce();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(tab.containerEl.textContent).not.toContain("gpt-old");
    expect(tab.containerEl.textContent).not.toContain("Old archived");

    clickButtonByLabel(tab, "Refresh Codex data");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(withShortLivedAppServerClientMock.mock.calls[1]?.[0]).toBe("/opt/codex");
    expect(tab.containerEl.textContent).toContain("gpt-new");
    expect(tab.containerEl.textContent).toContain("New archived");
  });

  it("unsubscribes model updates when the settings tab is hidden", () => {
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(settingsClient()),
    );
    const unsubscribe = vi.fn();
    const observeModels = vi.fn(() => unsubscribe);
    const tab = newSettingsTab({ observeModels });

    tab.hide();
    tab.display();

    expect(observeModels).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores stale settings data refresh results after a newer refresh completes", async () => {
    const firstModels = deferred<ModelMetadata[]>();
    const firstClient = settingsClient({
      threads: [appServerThread({ id: "thread-old", preview: "Old" })],
    });
    const secondClient = settingsClient({
      models: [model("gpt-new")],
      threads: [appServerThread({ id: "thread-new", preview: "New" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(firstClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(secondClient),
      );
    const refreshModels = vi
      .fn()
      .mockReturnValueOnce(firstModels.promise)
      .mockResolvedValueOnce(modelMetadataFromCatalogModels([model("gpt-new")]));
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshModels }), { display: vi.fn(), notify: vi.fn() });

    const firstRefresh = controller.refreshSettingsData();
    await flushPromises();
    await controller.refreshSettingsData();

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New"]);

    firstModels.resolve(modelMetadataFromCatalogModels([model("gpt-old")]));
    await firstRefresh;

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New"]);
  });

  it("ignores stale hook reload results after a newer dynamic operation completes", async () => {
    const staleHooks = deferred<{
      data: { cwd: string; hooks: CatalogHookMetadata[]; warnings: string[]; errors: unknown[] }[];
    }>();
    const initialClient = settingsClient({
      hooks: [hook({ key: "hook-initial", command: "initial hook", currentHash: "initialhash" })],
    });
    const trustClient = {
      trustHook: vi.fn().mockResolvedValue({}),
    };
    const staleClient = settingsClient();
    staleClient.listHooks.mockReturnValue(staleHooks.promise);
    const newerClient = settingsClient({
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(initialClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(trustClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(staleClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(newerClient),
      );
    const controller = new SettingsDynamicDataController(settingsTabHost(), { display: vi.fn(), notify: vi.fn() });

    await controller.refreshSettingsData();
    const initialHook = controller.snapshot().hooks[0];
    if (!initialHook) throw new Error("Expected initial hook to load");
    const staleReload = controller.trustHook(initialHook);
    await flushPromises();
    await controller.refreshSettingsData();

    expect(controller.snapshot().hooks.map((hook) => hook.currentHash)).toEqual(["newhash"]);

    staleHooks.resolve({
      data: [{ cwd: "/vault", hooks: [hook({ key: "hook-old", command: "old hook", currentHash: "oldhash" })], warnings: [], errors: [] }],
    });
    await staleReload;

    expect(controller.snapshot().hooks.map((item) => item.currentHash)).toEqual(["newhash"]);
  });

  it("keeps full refresh models and archived threads current when hook operations overlap", async () => {
    const models = deferred<readonly ModelMetadata[]>();
    const fullRefreshClient = settingsClient({
      hooks: [hook({ key: "hook-full", command: "full refresh hook", currentHash: "fullhash" })],
      threads: [appServerThread({ id: "thread-full", preview: "Full archived" })],
    });
    const trustClient = {
      trustHook: vi.fn().mockResolvedValue({}),
    };
    const hookReloadClient = settingsClient({
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(fullRefreshClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(trustClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(hookReloadClient),
      );
    const refreshModels = vi.fn().mockReturnValue(models.promise);
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshModels }), { display: vi.fn(), notify: vi.fn() });

    const fullRefresh = controller.refreshSettingsData();
    await flushPromises();
    await controller.trustHook(hook({ key: "hook-initial", command: "initial hook", currentHash: "initialhash" }));

    models.resolve(modelMetadataFromCatalogModels([model("gpt-refreshed")]));
    await fullRefresh;

    const snapshot = controller.snapshot();
    expect(snapshot.models.map((item) => item.model)).toEqual(["gpt-refreshed"]);
    expect(snapshot.modelsLifecycle.kind).toBe("loaded");
    expect(snapshot.archivedThreads.map((thread) => thread.preview)).toEqual(["Full archived"]);
    expect(snapshot.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshot.hooks.map((item) => item.currentHash)).toEqual(["newhash"]);
  });

  it("ignores stale archived restore results after a newer dynamic operation completes", async () => {
    const staleRestore = deferred<{ thread: ThreadRecord }>();
    const refreshActiveThreads = vi.fn().mockResolvedValue([]);
    const initialClient = settingsClient({
      threads: [appServerThread({ id: "thread-old", preview: "Old archived" })],
    });
    const restoreClient = {
      unarchiveThread: vi.fn(() => staleRestore.promise),
    };
    const newerClient = settingsClient({
      threads: [appServerThread({ id: "thread-new", preview: "New archived" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(initialClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(restoreClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(newerClient),
      );
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshActiveThreads }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

    await controller.refreshSettingsData();
    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    await controller.refreshSettingsData();

    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New archived"]);

    staleRestore.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await restore;

    expect(refreshActiveThreads).not.toHaveBeenCalled();
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New archived"]);
  });

  it("keeps restored archived threads removed when active thread refresh fails", async () => {
    const notify = vi.fn();
    const refreshActiveThreads = vi.fn().mockRejectedValue(new Error("offline"));
    const initialClient = settingsClient({
      threads: [appServerThread({ id: "thread-old", preview: "Old archived" })],
    });
    const restoreClient = {
      unarchiveThread: vi.fn().mockResolvedValue({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) }),
    };
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(initialClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(restoreClient),
      );
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshActiveThreads }), { display: vi.fn(), notify });

    await controller.refreshSettingsData();
    await controller.restoreArchivedThread("thread-old");

    const snapshot = controller.snapshot();
    expect(snapshot.archivedThreads).toEqual([]);
    expect(snapshot.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(refreshActiveThreads).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Could not refresh active Codex threads.");
    expect(notify).not.toHaveBeenCalledWith("Could not restore archived Codex thread.");
  });

  it("displays restored archived thread state before active thread refresh completes", async () => {
    const activeRefresh = deferred<readonly Thread[]>();
    const snapshots: SettingsDynamicDataSnapshot[] = [];
    const initialClient = settingsClient({
      threads: [appServerThread({ id: "thread-old", preview: "Old archived" })],
    });
    const restoreClient = {
      unarchiveThread: vi.fn().mockResolvedValue({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) }),
    };
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(initialClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(restoreClient),
      );
    const controllerRef: { current: SettingsDynamicDataController | null } = { current: null };
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshActiveThreads: () => activeRefresh.promise }), {
      display: () => {
        const snapshot = controllerRef.current?.snapshot();
        if (snapshot) snapshots.push(snapshot);
      },
      notify: vi.fn(),
    });
    controllerRef.current = controller;

    await controller.refreshSettingsData();
    snapshots.length = 0;
    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("loaded");

    activeRefresh.resolve([]);
    await restore;
  });

  it("uses cached models initially and publishes refreshed models", async () => {
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    const client = settingsClient({ models: [model("gpt-5.5")] });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
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
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
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
    expect(selectForSetting(tab, "Automatic thread naming")?.classList.contains("dropdown")).toBe(true);
    expect(selectForSetting(tab, "Selection rewrite")?.classList.contains("dropdown")).toBe(true);
  });

  it("keeps successful sections when one settings data request fails", async () => {
    const client = settingsClient({
      models: [model("gpt-5.4")],
      hooksError: new Error("hooks unavailable"),
      threads: [appServerThread({ preview: "Archived thread" })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).not.toContain("Loaded 1 model.");
    expect(tab.containerEl.textContent).toContain("Could not load hooks: hooks unavailable");
    expect(tab.containerEl.querySelector(".codex-panel-settings__refresh-status")).toBeNull();
    expect(tab.containerEl.textContent).toContain("Archived thread");
    expect(notices).toEqual(["Could not refresh all Codex data."]);
  });

  it("renders archived threads and hooks as dynamic setting rows", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-1", command: "node hook.js", currentHash: "abc123", trustStatus: "untrusted" })],
      threads: [appServerThread({ id: "thread-archived", preview: "Archived thread" })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("Restore archived threads, or permanently delete archived threads you no longer need.");
    expect(tab.containerEl.textContent).not.toContain("Loaded 1 hook from Codex app server.");
    expect(tab.containerEl.textContent).not.toContain("Loaded 1 archived thread from Codex app server.");
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-section .setting-item-heading")?.textContent).toContain(
      "Hook status",
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-section .setting-item-heading")?.textContent).toContain(
      "Thread archiving",
    );
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__hook-list .setting-item")).toHaveLength(1);
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .setting-item")).toHaveLength(1);
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-list")?.textContent).toContain("abc123");
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list")?.textContent).toContain("Archived thread");
  });

  it("confirms archived thread deletion inline and cancels from outside clicks", async () => {
    const client = settingsClient({
      threads: [appServerThread({ id: "thread-archived", preview: "Archived thread" })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete Archived thread");

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();
    expect(tab.containerEl.textContent).toContain("Permanently delete this archived thread? This cannot be undone.");
    expect(tab.containerEl.querySelector("[aria-label='Confirm permanent delete Archived thread']")?.getAttribute("data-icon")).toBe(
      "check",
    );

    tab.containerEl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).toBeNull();
    expect(tab.containerEl.textContent).not.toContain("Permanently delete this archived thread?");
    expect(client.deleteThread).not.toHaveBeenCalled();
  });

  it("keeps the settings shell mounted while dynamic sections update", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const client = settingsClient({
      threads: [appServerThread({ id: "thread-archived", preview: "Archived thread" })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    await flushPromises();

    const codexInput = inputForSetting(tab, "Codex executable");
    const shortcut = selectForSetting(tab, "Send shortcut");
    const archiveToggle = inputForSetting(tab, "Save note by default");
    if (!codexInput || !shortcut || !archiveToggle) throw new Error("Missing settings controls");

    archiveToggle.checked = true;
    archiveToggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(inputForSetting(tab, "Codex executable")).toBe(codexInput);
    expect(selectForSetting(tab, "Send shortcut")).toBe(shortcut);

    clickButtonByLabel(tab, "Delete Archived thread");

    expect(inputForSetting(tab, "Codex executable")).toBe(codexInput);
    expect(selectForSetting(tab, "Send shortcut")).toBe(shortcut);
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();
  });

  it("permanently deletes an archived thread from the confirmed settings row", async () => {
    const client = settingsClient({
      threads: [appServerThread({ id: "thread-archived", preview: "Archived thread" })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete Archived thread");
    pointerDownButtonByLabel(tab, "Confirm permanent delete Archived thread");
    clickButtonByLabel(tab, "Confirm permanent delete Archived thread");
    await flushPromises();

    expect(client.deleteThread).toHaveBeenCalledWith("thread-archived");
    expect(tab.containerEl.textContent).toContain("No archived threads.");
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .setting-item")).toHaveLength(0);
  });
});

function panelThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ...overrides,
  };
}

function appServerThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    sessionId: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp",
    cliVersion: "codex-cli 0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function model(modelId: string, isDefault = false, hidden = false, efforts: ReasoningEffort[] = ["medium"]): CatalogModel {
  return {
    id: `${modelId}-id`,
    model: modelId,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: `Display ${modelId}`,
    description: "",
    isDefault,
    hidden,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
  } satisfies CatalogModel;
}

function hook(overrides: Partial<CatalogHookMetadata> = {}): CatalogHookMetadata {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    timeoutSec: 10n,
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    source: "project",
    pluginId: null,
    displayOrder: 0n,
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "trusted",
    ...overrides,
  };
}

function settingsClient(
  options: { models?: CatalogModel[]; hooks?: CatalogHookMetadata[]; hooksError?: Error; threads?: ThreadRecord[] } = {},
) {
  return {
    listModels: vi.fn().mockResolvedValue({ data: options.models ?? [model("gpt-5.4")] }),
    listHooks: vi.fn().mockImplementation(() => {
      if (options.hooksError) return Promise.reject(options.hooksError);
      return Promise.resolve({
        data: [
          {
            cwd: "/vault",
            hooks: options.hooks ?? [],
            warnings: [],
            errors: [],
          },
        ],
      });
    }),
    listThreads: vi.fn().mockResolvedValue({ data: options.threads ?? [appServerThread({ preview: "Archived" })] }),
    deleteThread: vi.fn().mockResolvedValue({}),
  };
}

function newSettingsTab(
  options: {
    saveSettings?: () => Promise<void>;
    sendShortcut?: "enter" | "mod-enter";
    modelsSnapshot?: ModelMetadata[];
    fetchModels?: () => Promise<readonly ModelMetadata[]>;
    refreshModels?: () => Promise<readonly ModelMetadata[]>;
    observeModels?: CodexPanelSettingTabHost["appServerData"]["observeModelsResult"];
    notifyContextChanged?: () => void;
    refreshOpenViews?: () => void;
    refreshActiveThreads?: () => Promise<readonly Thread[]>;
    settings?: Partial<{
      threadNamingModel: string | null;
      threadNamingEffort: string | null;
      rewriteSelectionModel: string | null;
      rewriteSelectionEffort: string | null;
    }>;
  } = {},
): CodexPanelSettingTab {
  return new CodexPanelSettingTab({} as never, {} as never, settingsTabHost(options));
}

function settingsTabHost(
  options: {
    saveSettings?: () => Promise<void>;
    sendShortcut?: "enter" | "mod-enter";
    modelsSnapshot?: ModelMetadata[];
    fetchModels?: () => Promise<readonly ModelMetadata[]>;
    refreshModels?: () => Promise<readonly ModelMetadata[]>;
    observeModels?: CodexPanelSettingTabHost["appServerData"]["observeModelsResult"];
    notifyContextChanged?: () => void;
    refreshOpenViews?: () => void;
    refreshActiveThreads?: () => Promise<readonly Thread[]>;
    settings?: Partial<{
      threadNamingModel: string | null;
      threadNamingEffort: string | null;
      rewriteSelectionModel: string | null;
      rewriteSelectionEffort: string | null;
    }>;
  } = {},
): CodexPanelSettingTabHost {
  return {
    settings: {
      codexPath: "codex",
      threadNamingModel: options.settings?.threadNamingModel ?? null,
      threadNamingEffort: options.settings?.threadNamingEffort ?? null,
      rewriteSelectionModel: options.settings?.rewriteSelectionModel ?? null,
      rewriteSelectionEffort: options.settings?.rewriteSelectionEffort ?? null,
      showToolbar: true,
      sendShortcut: options.sendShortcut ?? "enter",
      scrollThreadFromComposerEdges: false,
      archiveExportEnabled: false,
      archiveExportFolderTemplate: "Codex Archives",
      archiveExportFilenameTemplate: "{{date}} {{time}} {{title}} {{shortId}}.md",
      archiveExportTags: "",
    },
    vaultPath: "/vault",
    saveSettings: options.saveSettings ?? vi.fn().mockResolvedValue(undefined),
    refreshOpenViews: options.refreshOpenViews ?? vi.fn(),
    appServerData: {
      modelsSnapshot: vi.fn(() => options.modelsSnapshot ?? []),
      fetchModels: options.fetchModels ?? vi.fn().mockResolvedValue(options.modelsSnapshot ?? []),
      refreshModels: options.refreshModels ?? vi.fn().mockResolvedValue(options.modelsSnapshot ?? []),
      observeModelsResult: options.observeModels ?? vi.fn(() => () => undefined),
      notifyContextChanged: options.notifyContextChanged ?? vi.fn(),
    },
    threadCatalog: {
      refreshActiveThreads: options.refreshActiveThreads ?? vi.fn().mockResolvedValue([]),
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function settingNames(tab: CodexPanelSettingTab): string[] {
  return Array.from(settingsSectionRoots(tab)).flatMap((element) => {
    if (element.classList.contains("setting-item")) {
      return [element.querySelector(".setting-item-name")?.textContent ?? ""];
    }
    if (element.classList.contains("codex-panel-settings__section")) {
      return Array.from(element.querySelectorAll(":scope > .setting-item")).map((setting) => {
        return setting.querySelector(".setting-item-name")?.textContent ?? "";
      });
    }
    if (element.classList.contains("codex-panel-settings__dynamic-section")) {
      return [element.querySelector(":scope > .setting-item-heading .setting-item-name")?.textContent ?? ""];
    }
    return [];
  });
}

function settingsSectionRoots(tab: CodexPanelSettingTab): Element[] {
  return Array.from(tab.containerEl.children).flatMap((element) => {
    if (element.classList.contains("codex-panel-settings__preact-sections")) return Array.from(element.children);
    return [element];
  });
}

function settingDesc(tab: CodexPanelSettingTab, name: string): string {
  const setting = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
    (element) => element.querySelector(".setting-item-name")?.textContent === name,
  );
  return setting?.querySelector(".setting-item-description")?.textContent ?? "";
}

function buttonTexts(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll("button")).map((element) => element.textContent);
}

function buttonLabels(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll("button")).map((element) => element.ariaLabel ?? "");
}

function clickButtonByLabel(tab: CodexPanelSettingTab, label: string): void {
  buttonByLabel(tab, label).click();
}

function pointerDownButtonByLabel(tab: CodexPanelSettingTab, label: string): void {
  buttonByLabel(tab, label).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}

function buttonByLabel(tab: CodexPanelSettingTab, label: string): HTMLButtonElement {
  const button = Array.from(tab.containerEl.querySelectorAll("button")).find((element) => element.ariaLabel === label);
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
