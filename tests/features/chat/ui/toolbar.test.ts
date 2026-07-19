// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";

import { Toolbar, type ToolbarActions, type ToolbarViewModel } from "../../../../src/features/chat/ui/toolbar";
import { renderUiRoot } from "../../../../src/shared/dom/preact-root.dom";
import { changeInputValue, installObsidianDomShims } from "../../../support/dom";

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
    const newChatButton = parent.querySelector<HTMLElement>(".codex-panel__new-chat");
    expect(newChatButton?.getAttribute("aria-label")).toBe("Show chat actions");
    newChatButton?.click();
    expect(toggleChatActions).toHaveBeenCalled();
    expect(startNewThread).not.toHaveBeenCalled();
    const statusButton = parent.querySelector(".codex-panel__status-menu-toggle");
    expect(statusButton?.getAttribute("aria-label")).toBe("Show status");
    const historyButton = parent.querySelector<HTMLElement>(".codex-panel__history-toggle");
    expect(historyButton?.getAttribute("aria-label")).toBe("Show thread list");
    historyButton?.click();
    expect(toggleHistory).toHaveBeenCalled();
    parent.empty();
    mountToolbar(parent, toolbarModel({ newChatDisabled: true }), toolbarActions());
    expect(parent.querySelector<HTMLElement>(".codex-panel__new-chat")?.getAttribute("aria-label")).toBe("Show chat actions");

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
    const compactContext = vi.fn();
    const setGoal = vi.fn();
    const startSideChat = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({ chatActionsOpen: true, openPanel: "chat-actions" }),
      toolbarActions({ startNewThread, startSideChat, compactContext, setGoal }),
    );

    const items = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")];
    expect(items).toHaveLength(4);
    items[0]?.click();
    items[1]?.click();
    items[2]?.click();
    items[3]?.click();
    expect(startNewThread).toHaveBeenCalledOnce();
    expect(startSideChat).toHaveBeenCalledOnce();
    expect(compactContext).toHaveBeenCalledOnce();
    expect(setGoal).toHaveBeenCalledOnce();

    mountToolbar(
      parent,
      toolbarModel({ chatActionsOpen: true, openPanel: "chat-actions", newChatDisabled: true }),
      toolbarActions({ startNewThread, startSideChat, compactContext, setGoal }),
    );
    const disabledStart = expectPresent(
      [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__chat-actions-panel-item")].find(
        (item) => item.textContent === "Start new chat",
      ),
    );
    disabledStart.click();
    expect(startNewThread).toHaveBeenCalledOnce();
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
    expect(meters.map((meter) => meter.getAttribute("role"))).toEqual(["progressbar", "progressbar"]);
    expect(meters.map((meter) => meter.getAttribute("aria-valuenow"))).toEqual(["42", "21"]);
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

    expect([...parent.querySelectorAll(".codex-panel__status-diagnostics-title")].map((title) => title.textContent)).toEqual([
      "Connection diagnostics",
      "Permissions & Approvals",
      "Codex capabilities",
    ]);
    expect(parent.textContent).toContain("Codex capabilities");
    expect(parent.textContent).toContain("Tool providers");
    expect(parent.textContent).toContain("Process");
    expect(parent.textContent).toContain("Runtime Checks");
    expect(parent.textContent).toContain("Copy debug details");
    expect(parent.textContent).toContain("Refresh");
    expect(parent.textContent).toContain("codex-cli/1.2.3");
    expect(parent.querySelector(".codex-panel__status-diagnostics-row--error")?.textContent).toContain("model/list failed");
    const statusItems = [...parent.querySelectorAll<HTMLElement>(".codex-panel__status-panel-item")];
    statusItems.find((item) => item.textContent.includes("Refresh"))?.click();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("renders runtime permissions in the status menu without severity styling", () => {
    const parent = document.createElement("div");

    mountToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        permissionsAndApprovals: [
          {
            title: "Permissions",
            rows: [
              { label: "Profile", value: ":workspace" },
              { label: "Sandbox", value: "workspace-write" },
              { label: "Codex network", value: "blocked" },
              { label: "Extra writable roots", value: "Vault" },
            ],
          },
          {
            title: "Approvals",
            rows: [
              { label: "Approval policy", value: "on-request" },
              { label: "Auto review", value: "on" },
            ],
          },
        ],
        toolInventory: [{ title: "Tool providers", rows: [{ label: "Tool providers", value: "loaded" }] }],
      }),
      toolbarActions(),
    );

    expect(parent.textContent).toContain("Permissions & Approvals");
    expect(parent.textContent).toContain("Permissions");
    expect(parent.textContent).toContain("Approvals");
    expect([...parent.querySelectorAll(".codex-panel__status-diagnostics-section")].map((section) => section.textContent)).not.toContain(
      "Current thread",
    );
    expect(parent.textContent).toContain(":workspace");
    expect(parent.textContent).toContain("workspace-write");
    expect(parent.textContent).toContain("on");
    expect(parent.querySelector(".codex-panel__status-diagnostics-row--warning")).toBeNull();
    expect(parent.querySelector(".codex-panel__status-diagnostics-row--error")).toBeNull();
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
    document.body.append(parent);
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
    renameButton.click();
    expect(startRenameThread).toHaveBeenCalledWith("thread");
    const threadRow = parent.querySelector(".codex-panel__thread-row");
    expect(threadRow?.classList.contains("codex-panel__thread-row--selected")).toBe(true);

    const input = parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    if (!input) throw new Error("Missing thread rename input");
    expect(input.value).toBe("Draft title");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
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
    const renamedInput = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input"));
    renamedInput.dispatchEvent(new FocusEvent("blur"));
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    saveRenameThread.mockClear();
    renamedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(saveRenameThread).not.toHaveBeenCalled();
    renamedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    renamedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelRenameThread).toHaveBeenCalledWith("editing");
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    expect(autoNameThread).toHaveBeenCalledWith("editing");
    parent.remove();
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
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();
    archiveButtons[0]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", false);
    archiveButtons[1]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(startArchiveThread).not.toHaveBeenCalled();
  });

  it("renders shared history expansion as a nav-list item", () => {
    const parent = document.createElement("div");
    const loadMoreThreads = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({ historyOpen: true, openPanel: "history", hasMoreThreads: true }),
      toolbarActions({ loadMoreThreads }),
    );

    const loadMore = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loadMore.textContent).toBe("Load more threads");
    loadMore.click();
    expect(loadMoreThreads).toHaveBeenCalledOnce();

    mountToolbar(
      parent,
      toolbarModel({ historyOpen: true, openPanel: "history", hasMoreThreads: true, loadingMoreThreads: true }),
      toolbarActions({ loadMoreThreads }),
    );
    const loading = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loading.textContent).toBe("Loading more threads…");
    expect(loading.classList.contains("is-disabled")).toBe(true);
    loading.click();
    expect(loadMoreThreads).toHaveBeenCalledOnce();

    mountToolbar(
      parent,
      toolbarModel({ historyOpen: true, openPanel: "history", hasMoreThreads: true, threadListFetching: true }),
      toolbarActions({ loadMoreThreads }),
    );
    const refreshing = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(refreshing.textContent).toBe("Load more threads");
    expect(refreshing.classList.contains("is-disabled")).toBe(true);
    refreshing.click();
    expect(loadMoreThreads).toHaveBeenCalledOnce();
  });

  it("does not report an empty history while its first page is loading", () => {
    const parent = document.createElement("div");

    mountToolbar(parent, toolbarModel({ historyOpen: true, openPanel: "history", threads: [], threadListLoading: true }), toolbarActions());

    expect(parent.textContent).toContain("Loading threads…");
    expect(parent.textContent).not.toContain("No threads");
  });
});

function toolbarModel(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    newChatDisabled: false,
    sideChatStartDisabled: false,
    compactDisabled: false,
    goalMutationDisabled: false,
    chatActionsOpen: false,
    historyOpen: false,
    statusPanelOpen: false,
    rateLimit: null,
    debugDetails: () => "{}",
    openPanel: null,
    threads: [{ title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null }],
    connectLabel: "Reconnect",
    permissionsAndApprovals: [{ title: "Permissions", rows: [{ label: "Thread", value: "(none)" }] }],
    diagnostics: [{ title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/test" }] }],
    toolInventory: [{ title: "Tool providers", rows: [{ label: "Tool providers", value: "not loaded", level: "warning" }] }],
    ...overrides,
  };
}

interface ToolbarActionOverrides {
  toggleHistory?: () => void;
  startNewThread?: () => void;
  startSideChat?: () => void;
  toggleChatActions?: () => void;
  compactContext?: () => void;
  setGoal?: () => void;
  toggleStatusPanel?: () => void;
  connect?: () => void;
  refreshStatus?: () => void;
  copyDebugDetails?: (details: string) => void;
  resumeThread?: (threadId: string) => void;
  loadMoreThreads?: () => void;
  startArchiveThread?: (threadId: string) => void;
  archiveThread?: (threadId: string, saveMarkdown: boolean) => void;
  startRenameThread?: (threadId: string) => void;
  updateRenameDraft?: (threadId: string, value: string) => void;
  saveRenameThread?: (threadId: string, value: string) => void;
  cancelRenameThread?: (threadId: string) => void;
  autoNameThread?: (threadId: string) => void;
}

function toolbarActions(overrides: ToolbarActionOverrides = {}): ToolbarActions {
  return {
    primary: {
      toggleHistory: overrides.toggleHistory ?? vi.fn(),
      toggleChatActions: overrides.toggleChatActions ?? vi.fn(),
      toggleStatusPanel: overrides.toggleStatusPanel ?? vi.fn(),
    },
    chat: {
      startNewThread: overrides.startNewThread ?? vi.fn(),
      startSideChat: overrides.startSideChat ?? vi.fn(),
      compactContext: overrides.compactContext ?? vi.fn(),
      setGoal: overrides.setGoal ?? vi.fn(),
    },
    status: {
      connect: overrides.connect ?? vi.fn(),
      refreshStatus: overrides.refreshStatus ?? vi.fn(),
      copyDebugDetails: overrides.copyDebugDetails ?? vi.fn(),
    },
    threads: {
      loadMore: overrides.loadMoreThreads ?? vi.fn(),
      resume: overrides.resumeThread ?? vi.fn(),
      archive: {
        start: overrides.startArchiveThread ?? vi.fn(),
        confirm: overrides.archiveThread ?? vi.fn(),
      },
      rename: {
        start: overrides.startRenameThread ?? vi.fn(),
        updateDraft: overrides.updateRenameDraft ?? vi.fn(),
        save: overrides.saveRenameThread ?? vi.fn(),
        cancel: overrides.cancelRenameThread ?? vi.fn(),
        autoName: overrides.autoNameThread ?? vi.fn(),
      },
    },
  };
}
