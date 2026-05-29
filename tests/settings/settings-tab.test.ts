import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Thread } from "../../src/generated/app-server/v2/Thread";
import type { HookMetadata } from "../../src/generated/app-server/v2/HookMetadata";
import type { Model } from "../../src/generated/app-server/v2/Model";
import type { ReasoningEffort } from "../../src/generated/app-server/ReasoningEffort";
import { findModelByIdOrName, sortedAvailableModels, supportedEffortsForModel } from "../../src/runtime/model";
import { CodexPanelSettingTab } from "../../src/settings/tab";
import { archivedThreadDisplayTitle } from "../../src/domain/threads/model";
import { notices } from "../mocks/obsidian";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../../src/app-server/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

describe("settings tab", () => {
  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("HTMLButtonElement", dom.window.HTMLButtonElement);
    vi.stubGlobal("HTMLDivElement", dom.window.HTMLDivElement);
    vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
    vi.stubGlobal("HTMLSelectElement", dom.window.HTMLSelectElement);
    vi.stubGlobal("Event", dom.window.Event);
    withShortLivedAppServerClientMock.mockReset();
    notices.length = 0;
  });

  it("uses a placeholder for threads without a useful title", () => {
    expect(archivedThreadDisplayTitle(thread({ name: null, preview: "" }))).toBe("Untitled archived thread");
    expect(archivedThreadDisplayTitle(thread({ name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781" }))).toBe("Untitled archived thread");
  });

  it("normalizes and truncates archived thread titles", () => {
    expect(archivedThreadDisplayTitle(thread({ preview: "A title\nwith   extra\tspace" }))).toBe("A title with extra space");

    const title = archivedThreadDisplayTitle(thread({ preview: "x".repeat(120) }));
    expect(title).toHaveLength(96);
    expect(title.endsWith("...")).toBe(true);
  });

  it("sorts naming model choices by default flag and model id", () => {
    expect(
      sortedAvailableModels([model("z-model"), model("a-model"), model("b-default", true), model("hidden", false, true)]).map(
        (item) => item.model,
      ),
    ).toEqual(["b-default", "a-model", "z-model"]);
  });

  it("finds selected models and falls back to all efforts when none are reported", () => {
    const selected = model("gpt-5.4", false, false, ["low", "high"]);
    expect(findModelByIdOrName([selected], "gpt-5.4")).toBe(selected);
    expect(findModelByIdOrName([selected], selected.id)).toBe(selected);
    expect(supportedEffortsForModel(selected)).toEqual(["low", "high"]);
    expect(supportedEffortsForModel(model("custom", false, false, []))).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
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
      "Composer",
      "Send shortcut",
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
    const shortcut = tab.containerEl.querySelector<HTMLSelectElement>('select[aria-label="Send shortcut"]');
    if (!shortcut) throw new Error("Missing send shortcut dropdown");

    shortcut.value = "mod-enter";
    shortcut.dispatchEvent(new Event("change"));
    await flushPromises();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(settingDesc(tab, "Send shortcut")).toContain("Obsidian hotkeys");
    expect(tab.containerEl.querySelector(".codex-panel-settings__section-status")?.textContent ?? "").not.toContain("Obsidian hotkeys");
  });

  it("saves archive export settings", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const tab = newSettingsTab({ saveSettings });

    tab.display();
    const toggle = tab.containerEl.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const folder = inputForSetting(tab, "Saved note folder");
    const filename = inputForSetting(tab, "Saved note filename");
    const tags = inputForSetting(tab, "Saved note tags");
    if (!toggle || !folder || !filename || !tags) throw new Error("Missing archive export controls");

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
    const firstClient = settingsClient({ models: [model("gpt-5.4")], threads: [thread({ id: "thread-old", preview: "Old" })] });
    const secondClient = settingsClient({
      models: [model("gpt-5.5")],
      threads: [thread({ id: "thread-new", preview: "New" })],
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

  it("uses cached models initially and publishes refreshed models", async () => {
    const publishModels = vi.fn();
    const client = settingsClient({ models: [model("gpt-5.5")] });
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) => operation(client),
    );
    const tab = newSettingsTab({ cachedModels: [model("gpt-cached")], publishModels });

    tab.display();

    expect(tab.containerEl.textContent).toContain("gpt-cached");

    await flushPromises();

    expect(publishModels).toHaveBeenCalledWith([model("gpt-5.5")]);
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
  });

  it("keeps successful sections when one settings data request fails", async () => {
    const client = settingsClient({
      models: [model("gpt-5.4")],
      hooksError: new Error("hooks unavailable"),
      threads: [thread({ preview: "Archived thread" })],
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
      threads: [thread({ id: "thread-archived", preview: "Archived thread" })],
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

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    sessionId: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    forkedFromId: null,
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

function model(modelId: string, isDefault = false, hidden = false, efforts: ReasoningEffort[] = ["medium"]): Model {
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
  } satisfies Model;
}

function hook(overrides: Partial<HookMetadata> = {}): HookMetadata {
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

function settingsClient(options: { models?: Model[]; hooks?: HookMetadata[]; hooksError?: Error; threads?: Thread[] } = {}) {
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
    listThreads: vi.fn().mockResolvedValue({ data: options.threads ?? [thread({ preview: "Archived" })] }),
  };
}

function newSettingsTab(
  options: {
    saveSettings?: () => Promise<void>;
    sendShortcut?: "enter" | "mod-enter";
    cachedModels?: Model[];
    publishModels?: (models: Model[]) => void;
  } = {},
): CodexPanelSettingTab {
  return new CodexPanelSettingTab(
    {} as never,
    {
      settings: {
        codexPath: "codex",
        threadNamingModel: null,
        threadNamingEffort: null,
        rewriteSelectionModel: null,
        rewriteSelectionEffort: null,
        sendShortcut: options.sendShortcut ?? "enter",
        archiveExportEnabled: false,
        archiveExportFolderTemplate: "Codex Archives",
        archiveExportFilenameTemplate: "{{date}} {{time}} {{title}} {{shortId}}.md",
        archiveExportTags: "",
      },
      vaultPath: "/vault",
      saveSettings: options.saveSettings ?? vi.fn().mockResolvedValue(undefined),
      refreshSharedThreadListFromOpenSurface: vi.fn(),
      cachedModels: vi.fn(() => options.cachedModels ?? []),
      publishModels: options.publishModels ?? vi.fn(),
    } as never,
  );
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
