// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";

import { Toolbar, type ToolbarActions, type ToolbarViewModel } from "../../../../../src/features/chat/ui/toolbar";
import { renderUiRoot } from "../../../../../src/shared/ui/ui-root";
import { changeInputValue, installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function mountToolbar(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  renderUiRoot(parent, h(Toolbar, { model, actions }));
}

describe("Toolbar decisions", () => {
  it("renders toolbar controls as Obsidian-style action buttons", () => {
    const parent = document.createElement("div");
    const startNewThread = vi.fn();
    const toggleChatActions = vi.fn();
    const toggleHistory = vi.fn();
    const baseModel = toolbarModel();

    mountToolbar(parent, baseModel, toolbarActions({ startNewThread, toggleChatActions, toggleHistory }));

    const navButtons = parent.querySelector(".codex-panel__toolbar-buttons");
    expect(parent.querySelector(".codex-panel__runtime-area")).toBeNull();
    expect(parent.querySelector(".codex-panel__runtime-strip")).toBeNull();
    expect([...expectPresent(navButtons).children].map((button) => button.getAttribute("aria-label"))).toEqual([
      "Show thread list",
      "Show chat actions",
      "Show status",
    ]);
    expect(parent.querySelector(".codex-panel__plan-toggle")).toBeNull();
    expect(parent.querySelector(".codex-panel__auto-review-toggle")).toBeNull();
    expect(parent.querySelector(".codex-panel__runtime-model")).toBeNull();
    const newChatButton = parent.querySelector<HTMLButtonElement>(".codex-panel__new-chat");
    expect(newChatButton?.getAttribute("aria-label")).toBe("Show chat actions");
    expect(newChatButton?.dataset["icon"]).toBe("messages-square");
    expect(newChatButton?.classList.contains("nav-action-button")).toBe(true);
    expect(newChatButton?.disabled).toBe(false);
    newChatButton?.click();
    expect(toggleChatActions).toHaveBeenCalled();
    expect(startNewThread).not.toHaveBeenCalled();
    const statusButton = parent.querySelector(".codex-panel__status-menu-toggle");
    expect(statusButton?.tagName).toBe("BUTTON");
    expect(statusButton?.getAttribute("role")).toBeNull();
    expect(statusButton?.getAttribute("aria-label")).toBe("Show status");
    expect((statusButton as HTMLElement | null)?.dataset["icon"]).toBe("waypoints");
    expect(statusButton?.classList.contains("nav-action-button")).toBe(true);
    expect(statusButton?.classList.contains("clickable-icon")).toBe(true);
    const historyButton = parent.querySelector<HTMLButtonElement>(".codex-panel__history-toggle");
    expect(historyButton?.getAttribute("aria-label")).toBe("Show thread list");
    expect(historyButton?.classList.contains("nav-action-button")).toBe(true);
    expect(historyButton?.classList.contains("clickable-icon")).toBe(true);
    historyButton?.click();
    expect(toggleHistory).toHaveBeenCalled();
    parent.empty();
    mountToolbar(parent, toolbarModel({ newChatDisabled: true }), toolbarActions());
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__new-chat")?.disabled).toBe(true);

    parent.empty();
    mountToolbar(parent, toolbarModel({ chatActionsOpen: true, historyOpen: true, statusPanelOpen: true }), toolbarActions());
    expect(parent.querySelector(".codex-panel__history-toggle")?.getAttribute("aria-label")).toBe("Hide thread list");
    expect(parent.querySelector(".codex-panel__history-toggle")?.classList.contains("is-active")).toBe(true);
    expect(parent.querySelector(".codex-panel__new-chat")?.getAttribute("aria-label")).toBe("Hide chat actions");
    expect(parent.querySelector(".codex-panel__new-chat")?.classList.contains("is-active")).toBe(true);
    expect(parent.querySelector(".codex-panel__status-menu-toggle")?.getAttribute("aria-label")).toBe("Hide status");
    expect(parent.querySelector(".codex-panel__status-menu-toggle")?.classList.contains("is-active")).toBe(true);
  });

  it("renders chat actions in the new chat toolbar menu", () => {
    const parent = document.createElement("div");
    const startNewThread = vi.fn();
    const compactConversation = vi.fn();
    const setGoal = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({ chatActionsOpen: true, openPanel: "chat-actions" }),
      toolbarActions({ startNewThread, compactConversation, setGoal }),
    );

    const items = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")];
    expect(items.map((item) => item.textContent)).toEqual(["Start new chat", "Compact conversation", "Set goal..."]);
    expect(items.map((item) => item.getAttribute("role"))).toEqual(["menuitem", "menuitem", "menuitem"]);
    items[0]?.click();
    items[1]?.click();
    items[2]?.click();
    expect(startNewThread).toHaveBeenCalledOnce();
    expect(compactConversation).toHaveBeenCalledOnce();
    expect(setGoal).toHaveBeenCalledOnce();
  });

  it("keeps context out of the toolbar and Codex limits inside the status menu", () => {
    const parent = document.createElement("div");

    mountToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        rateLimit: {
          title: "Codex: 5h 42%, 1w 21%",
          level: "ok",
          rows: [
            {
              label: "5h",
              value: "42%",
              resetLabel: "reset in 2h",
              title: "Codex 5h: 42% used.",
              percent: 42,
              meterDivisions: 5,
              level: "ok",
            },
            {
              label: "1w",
              value: "21%",
              resetLabel: "reset in 3d 4h",
              title: "Codex 1w: 21% used.",
              percent: 21,
              meterDivisions: 7,
              level: "ok",
            },
          ],
        },
      }),
      toolbarActions(),
    );

    expect(parent.querySelector(".codex-panel__context-compact")).toBeNull();
    expect(parent.querySelector(".codex-panel__limit-compact")).toBeNull();
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("5h");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("42%");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("reset in 2h");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("1w");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("21%");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("reset in 3d 4h");
    const meters = [...parent.querySelectorAll<HTMLElement>(".codex-panel__limit-panel-meter")];
    expect(meters.map((meter) => meter.classList.contains("codex-panel__limit-panel-meter--divided"))).toEqual([true, true]);
    expect(meters[0]?.classList.contains("codex-panel__limit-panel-meter--5")).toBe(true);
    expect(meters[1]?.classList.contains("codex-panel__limit-panel-meter--7")).toBe(true);
    expect(meters.map((meter) => meter.getAttribute("role"))).toEqual(["progressbar", "progressbar"]);
    expect(meters.map((meter) => meter.getAttribute("aria-valuenow"))).toEqual(["42", "21"]);
    expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual([null, null]);
  });

  it("renders connection diagnostics in the status menu", () => {
    const parent = document.createElement("div");
    const refreshStatus = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        diagnostics: [
          { title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/1.2.3" }] },
          { title: "Runtime Checks", rows: [{ label: "diagnostics", value: "model/list failed", level: "error" }] },
        ],
      }),
      toolbarActions({ refreshStatus }),
    );

    expect(parent.querySelector(".codex-panel__connection-diagnostics-title")?.textContent).toBe("Connection");
    expect(parent.textContent).toContain("Codex capabilities");
    expect(parent.textContent).toContain("Tool providers");
    expect(parent.textContent).toContain("Process");
    expect(parent.textContent).toContain("Runtime Checks");
    expect(parent.textContent).toContain("Copy debug details");
    expect(parent.textContent).toContain("Refresh");
    expect(parent.textContent).toContain("codex-cli/1.2.3");
    expect(parent.querySelector(".codex-panel__connection-diagnostics-row--error")?.textContent).toContain("model/list failed");
    const statusItems = [...parent.querySelectorAll<HTMLElement>(".codex-panel__status-panel-item")];
    expect(statusItems.map((item) => item.getAttribute("role"))).toEqual(["menuitem", "menuitem", "menuitem"]);
    expect(statusItems.every((item) => item.getAttribute("aria-selected") === null)).toBe(true);
    statusItems.find((item) => item.textContent.includes("Refresh"))?.click();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("copies raw debug details from the status menu", () => {
    const parent = document.createElement("div");
    const copyDebugDetails = vi.fn();
    const debugDetails = JSON.stringify({ runtimeConfig: { model: "gpt-5.5" } }, null, 2);

    mountToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        debugDetails: () => debugDetails,
      }),
      toolbarActions({ copyDebugDetails }),
    );

    expect(parent.querySelector(".codex-panel__region--config")).toBeNull();
    expect(parent.querySelector(".codex-panel__debug-details")).toBeNull();
    expect(parent.textContent).not.toContain('"model": "gpt-5.5"');
    parent.querySelectorAll<HTMLButtonElement>(".codex-panel__status-panel-item")[2]?.click();
    expect(copyDebugDetails).toHaveBeenCalledWith(debugDetails);
    expect(parent.querySelector(".codex-panel__toolbar-panel .codex-panel__config")).toBeNull();
  });

  it("renders thread list rename actions and an inline rename editor", () => {
    const parent = document.createElement("div");
    const startRenameThread = vi.fn();
    const updateRenameDraft = vi.fn();
    const saveRenameThread = vi.fn();
    const cancelRenameThread = vi.fn();
    const autoNameThread = vi.fn();
    const actions = toolbarActions({ startRenameThread, updateRenameDraft, saveRenameThread, cancelRenameThread, autoNameThread });

    mountToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          { title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null },
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            disabled: false,
            canArchive: true,
            rename: { draft: "Draft title", generating: false },
          },
        ],
      }),
      actions,
    );

    const renameButton = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]'));
    expect(renameButton.classList.contains("nav-action-button")).toBe(false);
    renameButton.click();
    expect(startRenameThread).toHaveBeenCalledWith("thread");
    const threadRow = parent.querySelector(".codex-panel__thread-row");
    expect(threadRow?.classList.contains("codex-panel__thread-row--selected")).toBe(true);
    expect(threadRow?.classList.contains("is-selected")).toBe(true);

    const input = parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    if (!input) throw new Error("Missing thread rename input");
    expect(input.closest(".codex-panel__thread-rename")?.querySelector(".codex-panel__toolbar-panel-check")).toBeNull();
    expect(input.value).toBe("Draft title");
    changeInputValue(input, "New title");
    expect(updateRenameDraft).toHaveBeenCalledWith("editing", "New title");

    mountToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          { title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null },
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            disabled: false,
            canArchive: true,
            rename: { draft: "New title", generating: false },
          },
        ],
      }),
      actions,
    );
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")).dispatchEvent(new FocusEvent("blur"));
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancelRenameThread).toHaveBeenCalledWith("editing");
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.classList.contains("nav-action-button")).toBe(false);
    expect(autoNameThread).toHaveBeenCalledWith("editing");
  });

  it("renders auto-name loading without disabling the rename draft field", () => {
    const parent = document.createElement("div");

    mountToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            disabled: false,
            canArchive: true,
            rename: { draft: "Draft title", generating: true },
          },
        ],
      }),
      toolbarActions(),
    );

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")?.disabled).toBe(false);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
  });

  it("renders toolbar archive confirmation with the default action on the right", () => {
    const parent = document.createElement("div");
    const startArchiveThread = vi.fn();
    const archiveThread = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          {
            title: "Thread",
            threadId: "thread",
            selected: true,
            disabled: false,
            canArchive: true,
            archiveConfirm: { active: true, defaultSaveMarkdown: true },
            rename: null,
          },
        ],
      }),
      toolbarActions({ startArchiveThread, archiveThread }),
    );

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__archive-confirm"));
    const archiveButtons = [
      ...confirm.querySelectorAll<HTMLButtonElement>(".codex-panel__archive-alternate, .codex-panel__archive-default"),
    ];
    expect(archiveButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Archive thread without saving",
      "Save and archive thread",
    ]);
    expect(archiveButtons.every((button) => !button.classList.contains("nav-action-button"))).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();
    archiveButtons[0]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", false);
    archiveButtons[1]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(startArchiveThread).not.toHaveBeenCalled();
  });
});

function toolbarModel(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    newChatDisabled: false,
    chatActionsOpen: false,
    historyOpen: false,
    statusPanelOpen: false,
    rateLimit: null,
    debugDetails: () => "{}",
    openPanel: null,
    threads: [{ title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null }],
    connectLabel: "Reconnect",
    diagnostics: [{ title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/test" }] }],
    toolInventory: [{ title: "Tool providers", rows: [{ label: "Codex capabilities", value: "not loaded", level: "warning" }] }],
    ...overrides,
  };
}

function toolbarActions(overrides: Partial<ToolbarActions> = {}): ToolbarActions {
  return {
    toggleHistory: vi.fn(),
    startNewThread: vi.fn(),
    toggleChatActions: vi.fn(),
    compactConversation: vi.fn(),
    setGoal: vi.fn(),
    toggleStatusPanel: vi.fn(),
    connect: vi.fn(),
    refreshStatus: vi.fn(),
    copyDebugDetails: vi.fn(),
    resumeThread: vi.fn(),
    startArchiveThread: vi.fn(),
    archiveThread: vi.fn(),
    startRenameThread: vi.fn(),
    updateRenameDraft: vi.fn(),
    saveRenameThread: vi.fn(),
    cancelRenameThread: vi.fn(),
    autoNameThread: vi.fn(),
    ...overrides,
  };
}
