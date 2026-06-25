// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerClientAccessOptions } from "../../src/app-server/connection/client-access";
import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import { modelMetadataFromCatalogModels } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import type { ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import type { ObservedDataResult } from "../../src/domain/observed-data";
import type { Thread } from "../../src/domain/threads/model";
import { threadArchiveDisplayTitle } from "../../src/domain/threads/title";
import { SettingsDynamicDataController, type SettingsDynamicDataSnapshot } from "../../src/settings/dynamic-data-controller";
import type { CodexPanelSettingTabHost } from "../../src/settings/host";
import { CodexPanelSettingTab } from "../../src/settings/tab.obsidian";
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
    expect(threadArchiveDisplayTitle(panelThread({ name: null, preview: "" }))).toBe("Untitled thread");
    expect(threadArchiveDisplayTitle(panelThread({ name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781", preview: "" }))).toBe("Untitled thread");
    expect(threadArchiveDisplayTitle(panelThread({ name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781", preview: "Preview title" }))).toBe(
      "Preview title",
    );
  });

  it("normalizes and truncates archived thread titles", () => {
    expect(threadArchiveDisplayTitle(panelThread({ preview: "A title\nwith   extra\tspace" }))).toBe("A title with extra space");

    const title = threadArchiveDisplayTitle(panelThread({ preview: "x".repeat(120) }));
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

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(buttonLabels(tab)).toContain("Refresh Codex data");
    expect(buttonTexts(tab)).not.toContain("Refresh Codex data");
    expect(buttonTexts(tab)).not.toContain("Load models");
    expect(buttonTexts(tab)).not.toContain("Load hooks");
    expect(buttonTexts(tab)).not.toContain("Load archive list");
    expect(
      tab.containerEl.querySelector(".codex-panel-settings__header.setting-item-heading .setting-item-description")?.textContent,
    ).toContain("Codex Panel stores panel preferences only");
    expect(tab.containerEl.querySelector(".codex-panel-settings__header button")?.getAttribute("data-icon")).toBe("refresh-cw");
    expect(tab.containerEl.querySelector("h2")).toBeNull();
    expect(tab.containerEl.querySelector(".codex-panel-settings__general-section.setting-group > .setting-items")?.children).toHaveLength(
      2,
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__composer-section.setting-group > .setting-items")?.children).toHaveLength(
      2,
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__helper-section.setting-group > .setting-items")?.children).toHaveLength(2);
    expect(
      tab.containerEl.querySelector(".codex-panel-settings__archived-section > .setting-item-heading .setting-item-description")
        ?.textContent,
    ).toContain("Set the default archive action");
    expect(
      tab.containerEl.querySelector(".codex-panel-settings__archived-threads-section > .setting-item-heading .setting-item-description")
        ?.textContent,
    ).toContain("Restore or permanently delete");
    expect(
      tab.containerEl.querySelector(".codex-panel-settings__hook-section > .setting-item-heading .setting-item-description")?.textContent,
    ).toContain("Trust, enable, or disable");
    expect(
      tab.containerEl.querySelector(
        ".codex-panel-settings__archived-section.setting-group > .setting-items:not(.codex-panel-settings__dynamic-list)",
      )?.children,
    ).toHaveLength(4);
    expect(settingNames(tab)).toEqual([
      "Codex executable",
      "Show chat toolbar",
      "Composer",
      "Send shortcut",
      "Scroll thread from composer line edges",
      "Codex helpers",
      "Automatic thread naming",
      "Selection rewrite",
      "Thread archiving",
      "Save note by default",
      "Saved note folder",
      "Saved note filename",
      "Saved note tags",
      "Archived threads",
      "Hook status",
    ]);
  });

  it("saves the send shortcut setting and describes newline behavior", async () => {
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
    expect(settingDesc(tab, "Send shortcut")).toContain("Shift+Enter adds a newline");
    expect(tab.containerEl.querySelector(".codex-panel-settings__section-status")?.textContent ?? "").not.toContain("Shift+Enter");
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
    expect(settingDesc(tab, "Show chat toolbar")).toContain("toolbar above the chat panel");
  });

  it("saves the composer line edge scroll setting", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = inputForSetting(tab, "Scroll thread from composer line edges");
    if (!toggle) throw new Error("Missing composer line edge scroll toggle");

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(settingDesc(tab, "Scroll thread from composer line edges")).toContain("Up/Ctrl+P");
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
    expect(settingDesc(tab, "Save note by default")).toContain("default archive action");
    expect(settingDesc(tab, "Saved note filename")).toContain("{{shortId}}");
    expect(settingDesc(tab, "Saved note tags")).toContain("separated by commas");
  });

  it("refreshes models, hooks, and archived threads from the global refresh button", async () => {
    const firstClient = settingsClient({ models: [model("gpt-5.4")] });
    const secondClient = settingsClient({ models: [model("gpt-5.5")] });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(firstClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(secondClient),
      );
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.4")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-5.5")]));
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New", archived: true })]);
    const tab = newSettingsTab({ fetchModels, refreshModels, refreshArchived });

    tab.display();
    await flushPromises();
    clickButtonByLabel(tab, "Refresh Codex data");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(fetchModels).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledOnce();
    expect(refreshArchived).toHaveBeenCalledTimes(2);
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
    });
    const newClient = settingsClient({
      models: [model("gpt-new")],
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(oldClient))
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(newClient));
    const fetchModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-old")]));
    const refreshModels = vi.fn().mockResolvedValue(modelMetadataFromCatalogModels([model("gpt-new")]));
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old archived", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New archived", archived: true })]);
    const tab = newSettingsTab({ saveSettings, notifyContextChanged, refreshOpenViews, fetchModels, refreshModels, refreshArchived });

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

  it("subscribes model updates only while the settings tab is displayed", () => {
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(settingsClient()),
    );
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

  it("publishes archived thread catalog updates to the archived settings section", () => {
    let emitArchived = (_threads: readonly Thread[]): void => {
      throw new Error("Expected archived thread observer");
    };
    const display = vi.fn();
    const controller = new SettingsDynamicDataController(
      settingsTabHost({
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ data: threads, error: null, isFetching: false } satisfies ObservedDataResult<readonly Thread[]>);
          };
          return () => undefined;
        },
      }),
      { display, notify: vi.fn() },
    );

    controller.activate();
    emitArchived([panelThread({ id: "thread-archived", preview: "Archived elsewhere", archived: true })]);

    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["Archived elsewhere"]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("loaded");
    expect(display).toHaveBeenCalledWith("archived");
  });

  it("ignores stale settings data refresh results after a newer refresh completes", async () => {
    const firstModels = deferred<ModelMetadata[]>();
    const firstClient = settingsClient();
    const secondClient = settingsClient({ models: [model("gpt-new")] });
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
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New", archived: true })]);
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshModels, refreshArchived }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

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
    const refreshArchived = vi.fn().mockResolvedValue([panelThread({ id: "thread-full", preview: "Full archived", archived: true })]);
    const controller = new SettingsDynamicDataController(settingsTabHost({ refreshModels, refreshArchived }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

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
    const applyThreadCatalogEvent = vi.fn();
    const initialClient = settingsClient();
    const restoreClient = {
      unarchiveThread: vi.fn(() => staleRestore.promise),
    };
    const newerClient = settingsClient();
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
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old archived", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New archived", archived: true })]);
    const controller = new SettingsDynamicDataController(settingsTabHost({ applyThreadCatalogEvent, refreshArchived }), {
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

    expect(applyThreadCatalogEvent).not.toHaveBeenCalled();
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New archived"]);
  });

  it("records restored archived threads in the active catalog", async () => {
    const notify = vi.fn();
    const applyThreadCatalogEvent = vi.fn();
    const initialClient = settingsClient();
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
    const controller = new SettingsDynamicDataController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        applyThreadCatalogEvent,
      }),
      { display: vi.fn(), notify },
    );

    await controller.refreshSettingsData();
    await controller.restoreArchivedThread("thread-old");

    const snapshot = controller.snapshot();
    expect(snapshot.archivedThreads).toEqual([]);
    expect(snapshot.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
      type: "thread-restored",
      thread: expect.objectContaining({ id: "thread-old", preview: "Restored old", archived: false }),
    });
    expect(notify).not.toHaveBeenCalledWith("Could not restore archived Codex thread.");
  });

  it("displays restored archived thread state after recording the active catalog event", async () => {
    const snapshots: SettingsDynamicDataSnapshot[] = [];
    const initialClient = settingsClient();
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
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const controller = new SettingsDynamicDataController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ data: threads, error: null, isFetching: false } satisfies ObservedDataResult<readonly Thread[]>);
          };
          return () => undefined;
        },
        applyThreadCatalogEvent: () => {
          emitArchived([]);
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: vi.fn(),
      },
    );
    controllerRef.current = controller;

    await controller.refreshSettingsData();
    snapshots.length = 0;
    await controller.restoreArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.status).toBe('Restored "Restored old".');
  });

  it("displays deleted archived thread status after recording the catalog event", async () => {
    const snapshots: SettingsDynamicDataSnapshot[] = [];
    const initialClient = settingsClient();
    const deleteClient = {
      deleteThread: vi.fn().mockResolvedValue({}),
    };
    withShortLivedAppServerClientMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(initialClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(deleteClient),
      );
    const controllerRef: { current: SettingsDynamicDataController | null } = { current: null };
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const controller = new SettingsDynamicDataController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ data: threads, error: null, isFetching: false } satisfies ObservedDataResult<readonly Thread[]>);
          };
          return () => undefined;
        },
        applyThreadCatalogEvent: () => {
          emitArchived([]);
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: vi.fn(),
      },
    );
    controllerRef.current = controller;

    await controller.refreshSettingsData();
    snapshots.length = 0;
    await controller.deleteArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.status).toBe('Deleted "Old archived".');
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
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ archivedThreads: [panelThread({ preview: "Archived thread", archived: true })] });

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
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("Restore or permanently delete archived Codex threads.");
    expect(tab.containerEl.textContent).not.toContain("Loaded 1 hook from Codex app server.");
    expect(tab.containerEl.textContent).not.toContain("Loaded 1 archived thread from Codex app server.");
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-section .setting-item-heading")?.textContent).toContain(
      "Hook status",
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-section .setting-item-heading")?.textContent).toContain(
      "Thread archiving",
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-threads-section .setting-item-heading")?.textContent).toContain(
      "Archived threads",
    );
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__hook-list .codex-panel-settings__hook-row")).toHaveLength(1);
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .codex-panel-settings__archived-row")).toHaveLength(1);
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-list")?.textContent).not.toContain("abc123");
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list")?.textContent).toContain("Archived thread");
    expect(buttonLabels(tab)).toContain("Restore thread");
    expect(buttonLabels(tab)).toContain("Delete thread");
  });

  it("confirms archived thread deletion inline and cancels from outside clicks", async () => {
    const client = settingsClient();
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete thread");

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();
    expect(tab.containerEl.textContent).toContain("Permanently delete this archived thread? This cannot be undone.");
    expect(tab.containerEl.querySelector("[aria-label='Delete thread']")?.getAttribute("data-icon")).toBe("check");

    tab.containerEl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));

    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).toBeNull();
    expect(tab.containerEl.textContent).not.toContain("Permanently delete this archived thread?");
    expect(client.deleteThread).not.toHaveBeenCalled();
  });

  it("keeps the settings shell mounted while dynamic sections update", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const client = settingsClient();
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({
      saveSettings,
      archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })],
    });

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

    clickButtonByLabel(tab, "Delete thread");

    expect(inputForSetting(tab, "Codex executable")).toBe(codexInput);
    expect(selectForSetting(tab, "Send shortcut")).toBe(shortcut);
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-row--delete-confirming")).not.toBeNull();
  });

  it("rerenders only the changed dynamic section for archive and hook actions", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-1", command: "node hook.js", currentHash: "abc123", enabled: true })],
    });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const hookUpdate = deferred<undefined>();
    client.setHookEnabled.mockReturnValue(hookUpdate.promise);
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    const helperSection = dynamicSection(tab, "codex-panel-settings__helper-section");
    const archivedSection = dynamicSection(tab, "codex-panel-settings__archived-section");
    const hookSection = dynamicSection(tab, "codex-panel-settings__hook-section");
    const archiveToggle = inputForSetting(tab, "Save note by default");
    if (!archiveToggle) throw new Error("Missing archive toggle");

    archiveToggle.checked = true;
    archiveToggle.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(dynamicSection(tab, "codex-panel-settings__helper-section")).toBe(helperSection);
    expect(dynamicSection(tab, "codex-panel-settings__hook-section")).toBe(hookSection);

    clickButtonByLabel(tab, "Delete thread");

    expect(dynamicSection(tab, "codex-panel-settings__helper-section")).toBe(helperSection);
    expect(dynamicSection(tab, "codex-panel-settings__hook-section")).toBe(hookSection);

    clickButtonByText(tab, "Disable");
    await flushPromises();

    expect(client.setHookEnabled).toHaveBeenCalledOnce();
    expect(dynamicSection(tab, "codex-panel-settings__hook-section")).not.toBeNull();
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-list")).not.toBeNull();
    expect(dynamicSection(tab, "codex-panel-settings__helper-section")).toBe(helperSection);
    expect(dynamicSection(tab, "codex-panel-settings__archived-section")).toBe(archivedSection);

    hookUpdate.resolve(undefined);
    await flushPromises();
  });

  it("permanently deletes an archived thread from the confirmed settings row", async () => {
    const client = settingsClient();
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const deleteThread = deferred<undefined>();
    client.deleteThread.mockReturnValue(deleteThread.promise);
    const tab = newSettingsTab({ archivedThreads: [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })] });

    tab.display();
    await flushPromises();

    clickButtonByLabel(tab, "Delete thread");
    pointerDownButtonByLabel(tab, "Delete thread");
    clickButtonByLabel(tab, "Delete thread");
    await flushPromises();

    expect(client.deleteThread).toHaveBeenCalledWith("thread-archived");
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list")).not.toBeNull();

    deleteThread.resolve(undefined);
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("No archived threads.");
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-list .codex-panel-settings__status-row")?.textContent).toContain(
      "No archived threads.",
    );
    expect(tab.containerEl.querySelectorAll(".codex-panel-settings__archived-list .codex-panel-settings__archived-row")).toHaveLength(0);
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
    setHookEnabled: vi.fn().mockResolvedValue({}),
    trustHook: vi.fn().mockResolvedValue({}),
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
    archivedThreads?: Thread[];
    archivedSnapshot?: Thread[] | null;
    refreshArchived?: () => Promise<readonly Thread[]>;
    observeArchived?: CodexPanelSettingTabHost["threadCatalog"]["observeArchived"];
    applyThreadCatalogEvent?: CodexPanelSettingTabHost["threadCatalog"]["apply"];
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
    archivedThreads?: Thread[];
    archivedSnapshot?: Thread[] | null;
    refreshArchived?: () => Promise<readonly Thread[]>;
    observeArchived?: CodexPanelSettingTabHost["threadCatalog"]["observeArchived"];
    applyThreadCatalogEvent?: CodexPanelSettingTabHost["threadCatalog"]["apply"];
    settings?: Partial<{
      threadNamingModel: string | null;
      threadNamingEffort: string | null;
      rewriteSelectionModel: string | null;
      rewriteSelectionEffort: string | null;
    }>;
  } = {},
): CodexPanelSettingTabHost {
  const defaultArchivedThreads = [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })];
  const settings = {
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
  };
  return {
    settings,
    vaultPath: "/vault",
    clientAccess: {
      withClient: <T>(operation: (client: never) => Promise<T>, clientOptions?: AppServerClientAccessOptions) =>
        withShortLivedAppServerClientMock(settings.codexPath, "/vault", operation, clientOptions) as Promise<T>,
    },
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
      archivedSnapshot: vi.fn(() => options.archivedSnapshot ?? null),
      loadArchived: vi.fn().mockResolvedValue(options.archivedThreads ?? defaultArchivedThreads),
      refreshArchived: options.refreshArchived ?? vi.fn().mockResolvedValue(options.archivedThreads ?? defaultArchivedThreads),
      observeArchived: options.observeArchived ?? vi.fn(() => () => undefined),
      apply: options.applyThreadCatalogEvent ?? vi.fn(),
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
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
  return Array.from(tab.containerEl.children).flatMap((element) => {
    if (element.classList.contains("codex-panel-settings__preact-sections")) {
      return Array.from(element.children).flatMap((root) => Array.from(root.children));
    }
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
  return Array.from(tab.containerEl.querySelectorAll<HTMLElement>("button, [aria-label]")).map((element) => element.ariaLabel ?? "");
}

function clickButtonByLabel(tab: CodexPanelSettingTab, label: string): void {
  buttonByLabel(tab, label).click();
}

function clickButtonByText(tab: CodexPanelSettingTab, text: string): void {
  const button = Array.from(tab.containerEl.querySelectorAll("button")).find((element) => element.textContent === text);
  if (!button) throw new Error(`Could not find button text: ${text}`);
  button.click();
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

function dynamicSection(tab: CodexPanelSettingTab, className: string): Element {
  const section = tab.containerEl.querySelector(`.${className}`);
  if (!section) throw new Error(`Missing dynamic section: ${className}`);
  return section;
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
