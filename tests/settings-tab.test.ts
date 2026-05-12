import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Thread } from "../src/generated/app-server/v2/Thread";
import type { HookMetadata } from "../src/generated/app-server/v2/HookMetadata";
import type { Model } from "../src/generated/app-server/v2/Model";
import type { ReasoningEffort } from "../src/generated/app-server/ReasoningEffort";
import { findModelByIdOrName, sortedAvailableModels, supportedEffortsForModel } from "../src/panel/model-runtime";
import { CodexPanelSettingTab } from "../src/settings-tab";
import { archivedThreadDisplayTitle } from "../src/threads";
import { notices } from "./mocks/obsidian";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

const { withAppServerSessionMock } = vi.hoisted(() => ({
  withAppServerSessionMock: vi.fn(),
}));

vi.mock("../src/app-server/session-client", () => ({
  withAppServerSession: withAppServerSessionMock,
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
    withAppServerSessionMock.mockReset();
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
    withAppServerSessionMock.mockImplementation((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
      operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(withAppServerSessionMock).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.listHooks).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledWith("/vault", true);

    tab.display();
    await flushPromises();

    expect(withAppServerSessionMock).toHaveBeenCalledTimes(1);
    expect(buttonTexts(tab)).toContain("Refresh settings data");
    expect(buttonTexts(tab)).not.toContain("Load models");
    expect(buttonTexts(tab)).not.toContain("Load hooks");
    expect(buttonTexts(tab)).not.toContain("Load archive list");
    expect(tab.containerEl.querySelector("h2")).toBeNull();
    expect(settingNames(tab)).toEqual([
      "General",
      "Settings data",
      "Codex executable",
      "Thread naming model",
      "Hook status",
      "Archived thread list",
    ]);
  });

  it("refreshes models, hooks, and archived threads from the global refresh button", async () => {
    const firstClient = settingsClient({ models: [model("gpt-5.4")], threads: [thread({ id: "thread-old", preview: "Old" })] });
    const secondClient = settingsClient({
      models: [model("gpt-5.5")],
      threads: [thread({ id: "thread-new", preview: "New" })],
    });
    withAppServerSessionMock
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(firstClient),
      )
      .mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
        operation(secondClient),
      );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();
    clickButton(tab, "Refresh settings data");
    await flushPromises();

    expect(withAppServerSessionMock).toHaveBeenCalledTimes(2);
    expect(tab.containerEl.textContent).toContain("gpt-5.5");
    expect(tab.containerEl.textContent).toContain("New");
    expect(tab.containerEl.textContent).not.toContain("Old");
  });

  it("keeps successful sections when one settings data request fails", async () => {
    const client = settingsClient({
      models: [model("gpt-5.4")],
      hooksError: new Error("hooks unavailable"),
      threads: [thread({ preview: "Archived thread" })],
    });
    withAppServerSessionMock.mockImplementation((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
      operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).not.toContain("Loaded 1 model.");
    expect(tab.containerEl.textContent).toContain("Could not load hooks: hooks unavailable");
    expect(tab.containerEl.textContent).toContain("Archived thread");
    expect(notices).toEqual(["Could not refresh all Codex settings data."]);
  });

  it("renders archived threads and hooks as dynamic setting rows", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-1", command: "node hook.js", currentHash: "abc123", trustStatus: "untrusted" })],
      threads: [thread({ id: "thread-archived", preview: "Archived thread" })],
    });
    withAppServerSessionMock.mockImplementation((_codexPath: string, _cwd: string, operation: (client: unknown) => Promise<unknown>) =>
      operation(client),
    );
    const tab = newSettingsTab();

    tab.display();
    await flushPromises();

    expect(tab.containerEl.textContent).toContain("Loaded 1 hook from Codex app-server.");
    expect(tab.containerEl.textContent).toContain("Loaded 1 archived thread from Codex app-server.");
    expect(tab.containerEl.querySelector(".codex-panel-settings__hook-section .setting-item-heading")?.textContent).toContain(
      "Hook status",
    );
    expect(tab.containerEl.querySelector(".codex-panel-settings__archived-section .setting-item-heading")?.textContent).toContain(
      "Archived thread list",
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

function newSettingsTab(): CodexPanelSettingTab {
  return new CodexPanelSettingTab(
    {} as never,
    {
      settings: {
        codexPath: "codex",
        threadNamingModel: null,
        threadNamingEffort: null,
      },
      vaultPath: "/vault",
      saveSettings: vi.fn().mockResolvedValue(undefined),
      refreshOpenThreadLists: vi.fn(),
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
    if (element.classList.contains("codex-panel-settings__general-section")) {
      return Array.from(element.querySelectorAll(":scope > .setting-item")).map(
        (setting) => setting.querySelector(".setting-item-name")?.textContent ?? "",
      );
    }
    if (element.classList.contains("codex-panel-settings__dynamic-section")) {
      return [element.querySelector(":scope > .setting-item-heading .setting-item-name")?.textContent ?? ""];
    }
    return [];
  });
}

function buttonTexts(tab: CodexPanelSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll("button")).map((element) => element.textContent ?? "");
}

function clickButton(tab: CodexPanelSettingTab, text: string): void {
  const button = Array.from(tab.containerEl.querySelectorAll("button")).find((element) => element.textContent === text);
  if (!button) throw new Error(`Could not find button: ${text}`);
  button.click();
}
