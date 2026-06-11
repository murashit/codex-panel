// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerHookMetadata, AppServerModel } from "../../src/app-server/catalog-model";
import type { AppServerThread } from "../../src/app-server/thread-model";
import type { ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import { modelMetadataFromAppServerModels } from "../../src/app-server/catalog-model";
import { CodexPanelSettingTab } from "../../src/settings/tab";
import { archivedThreadDisplayTitle, type Thread } from "../../src/domain/threads/model";
import { notices } from "../mocks/obsidian";
import { deferred } from "../support/async";
import { installObsidianDomShims } from "../support/dom";

installObsidianDomShims();

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../../src/app-server/short-lived-client", () => ({
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
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.listHooks).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledWith("/vault", true);

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
    expect(inputForSetting(tab, "Codex executable")?.getAttribute("aria-label")).toBe("Codex executable");
    const shortcut = tab.containerEl.querySelector<HTMLSelectElement>('select[aria-label="Send shortcut"]');
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
    expect(folder.getAttribute("aria-label")).toBe("Saved note folder");
    expect(filename.getAttribute("aria-label")).toBe("Saved note filename");
    expect(tags.getAttribute("aria-label")).toBe("Saved note tags");

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
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();
    clickButtonByLabel(tab, "Refresh Codex data");
    await flushPromises();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
    expect(tab.containerEl.textContent).toContain("New");
    expect(tab.containerEl.textContent).not.toContain("Old");
  });

  it("ignores stale settings data refresh results after a newer refresh completes", async () => {
    const firstModels = deferred<{ data: AppServerModel[] }>();
    const firstClient = settingsClient({
      threads: [appServerThread({ id: "thread-old", preview: "Old" })],
    });
    firstClient.listModels.mockReturnValue(firstModels.promise);
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
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();
    const secondRefresh = (tab as unknown as { refreshSettingsData(): Promise<void> }).refreshSettingsData();
    await secondRefresh;

    expect(tab.containerEl.textContent).toContain("gpt-new");
    expect(tab.containerEl.textContent).toContain("New");

    firstModels.resolve({ data: [model("gpt-old")] });
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("gpt-new");
    expect(tab.containerEl.textContent).toContain("New");
    expect(tab.containerEl.textContent).not.toContain("gpt-old");
    expect(tab.containerEl.textContent).not.toContain("Old");
  });

  it("ignores stale hook reload results after a newer dynamic operation completes", async () => {
    const staleHooks = deferred<{
      data: { cwd: string; hooks: AppServerHookMetadata[]; warnings: string[]; errors: unknown[] }[];
    }>();
    const initialClient = settingsClient({
      hooks: [hook({ key: "hook-initial", command: "initial hook", currentHash: "initialhash" })],
    });
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
        operation(staleClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(newerClient),
      );
    const tab = newSettingsTab();
    const actions = settingsTabPrivateActions(tab);

    tab.display();
    await flushPromises();
    const staleReload = actions.loadHooks();
    await flushPromises();
    await actions.refreshSettingsData();

    expect(tab.containerEl.textContent).toContain("newhash");

    staleHooks.resolve({
      data: [{ cwd: "/vault", hooks: [hook({ key: "hook-old", command: "old hook", currentHash: "oldhash" })], warnings: [], errors: [] }],
    });
    await staleReload;

    expect(tab.containerEl.textContent).toContain("newhash");
    expect(tab.containerEl.textContent).not.toContain("oldhash");
  });

  it("ignores stale archived restore results after a newer dynamic operation completes", async () => {
    const staleRestore = deferred<{ thread: AppServerThread }>();
    const refreshSharedThreadListFromOpenSurface = vi.fn();
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
    const tab = newSettingsTab({ refreshSharedThreadListFromOpenSurface });
    const actions = settingsTabPrivateActions(tab);

    tab.display();
    await flushPromises();
    const restore = actions.restoreArchivedThread("thread-old");
    await flushPromises();
    await actions.refreshSettingsData();

    expect(tab.containerEl.textContent).toContain("New archived");

    staleRestore.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await restore;

    expect(refreshSharedThreadListFromOpenSurface).not.toHaveBeenCalled();
    expect(tab.containerEl.textContent).toContain("New archived");
    expect(tab.containerEl.textContent).not.toContain("Old archived");
  });

  it("uses cached models initially and publishes refreshed models", async () => {
    const publishModels = vi.fn();
    const client = settingsClient({ models: [model("gpt-5.5")] });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ cachedModels: modelMetadataFromAppServerModels([model("gpt-cached")]), publishModels });

    tab.display();

    expect(tab.containerEl.textContent).toContain("gpt-cached");

    await flushPromises();

    expect(publishModels).toHaveBeenCalledWith(modelMetadataFromAppServerModels([model("gpt-5.5")]));
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
  });

  it("uses model-provided reasoning efforts in helper settings while preserving saved unknown values", async () => {
    const tab = newSettingsTab({
      cachedModels: modelMetadataFromAppServerModels([model("gpt-5.5", false, false, ["extreme"])]),
      settings: {
        threadNamingModel: "gpt-5.5",
        threadNamingEffort: "saved-custom-effort",
        rewriteSelectionModel: "gpt-5.5",
        rewriteSelectionEffort: "extreme",
      },
    });

    tab.display();

    expect(selectOptions(tab, "Automatic thread naming effort")).toEqual(["Codex default", "saved-custom-effort (saved)", "extreme"]);
    expect(selectOptions(tab, "Selection rewrite effort")).toEqual(["Codex default", "extreme"]);
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

    expect(tab.containerEl.textContent).toContain("Restore archived threads to the active thread list.");
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

function appServerThread(overrides: Partial<AppServerThread> = {}): AppServerThread {
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
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function model(modelId: string, isDefault = false, hidden = false, efforts: ReasoningEffort[] = ["medium"]): AppServerModel {
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
  } satisfies AppServerModel;
}

function hook(overrides: Partial<AppServerHookMetadata> = {}): AppServerHookMetadata {
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
  options: { models?: AppServerModel[]; hooks?: AppServerHookMetadata[]; hooksError?: Error; threads?: AppServerThread[] } = {},
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
  };
}

function newSettingsTab(
  options: {
    saveSettings?: () => Promise<void>;
    sendShortcut?: "enter" | "mod-enter";
    cachedModels?: ModelMetadata[];
    publishModels?: (models: ModelMetadata[]) => void;
    refreshOpenViews?: () => void;
    refreshSharedThreadListFromOpenSurface?: () => void;
    settings?: Partial<{
      threadNamingModel: string | null;
      threadNamingEffort: string | null;
      rewriteSelectionModel: string | null;
      rewriteSelectionEffort: string | null;
    }>;
  } = {},
): CodexPanelSettingTab {
  return new CodexPanelSettingTab(
    {} as never,
    {} as never,
    {
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
      refreshSharedThreadListFromOpenSurface: options.refreshSharedThreadListFromOpenSurface ?? vi.fn(),
      cachedModels: vi.fn(() => options.cachedModels ?? []),
      publishModels: options.publishModels ?? vi.fn(),
    } as never,
  );
}

function settingsTabPrivateActions(tab: CodexPanelSettingTab): {
  loadHooks(): Promise<void>;
  refreshSettingsData(): Promise<void>;
  restoreArchivedThread(threadId: string): Promise<void>;
} {
  return tab as unknown as {
    loadHooks(): Promise<void>;
    refreshSettingsData(): Promise<void>;
    restoreArchivedThread(threadId: string): Promise<void>;
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function settingNames(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.children).flatMap((element) => {
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
  const button = Array.from(tab.containerEl.querySelectorAll("button")).find((element) => element.ariaLabel === label);
  if (!button) throw new Error(`Could not find button: ${label}`);
  button.click();
}

function inputForSetting(tab: CodexPanelSettingTab, name: string): HTMLInputElement | null {
  const setting = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
    (element) => element.querySelector(".setting-item-name")?.textContent === name,
  );
  return setting?.querySelector("input") ?? null;
}

function selectOptions(tab: CodexPanelSettingTab, ariaLabel: string): string[] {
  const select = tab.containerEl.querySelector<HTMLSelectElement>(`select[aria-label="${ariaLabel}"]`);
  if (!select) throw new Error(`Missing select: ${ariaLabel}`);
  return Array.from(select.options).map((option) => option.textContent);
}
