// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";

import { Toolbar, type ToolbarActions } from "../../../../src/features/chat/ui/toolbar";
import type { ToolbarViewModel } from "../../../../src/features/chat/ui/toolbar-model";
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
  it("renders chat actions in the new chat toolbar menu", () => {
    const parent = document.createElement("div");
    const startNewThread = vi.fn();
    const compactContext = vi.fn();
    const setGoal = vi.fn();
    const startSideChat = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({ openPanel: "chat-actions" }),
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
      toolbarModel({ openPanel: "chat-actions", newChatDisabled: true }),
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
        openPanel: "status",
        rateLimit: {
          rows: [
            {
              label: "5h",
              value: "42%",
              resetLabel: "reset in 2h",
              percent: 42,
              meterDivisions: 5,
              level: "ok",
            },
            {
              label: "1w",
              value: "21%",
              resetLabel: "reset in 3d 4h",
              percent: 21,
              meterDivisions: 7,
              level: "ok",
            },
          ],
        },
      }),
      toolbarActions(),
    );

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
    expect(parent.textContent).toContain(":workspace");
    expect(parent.textContent).toContain("workspace-write");
    expect(parent.textContent).toContain("on");
    expect(parent.querySelector(".codex-panel__status-diagnostics-row--warning")).toBeNull();
    expect(parent.querySelector(".codex-panel__status-diagnostics-row--error")).toBeNull();
  });

  it("requests debug detail copying from the status menu", () => {
    const parent = document.createElement("div");
    const copyDebugDetails = vi.fn();

    mountToolbar(parent, toolbarModel({ openPanel: "status" }), toolbarActions({ copyDebugDetails }));

    parent.querySelectorAll<HTMLButtonElement>(".codex-panel__status-panel-item")[2]?.click();
    expect(copyDebugDetails).toHaveBeenCalledOnce();
  });

  it("adapts thread row controls and the inline editor to toolbar actions", () => {
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
        openPanel: "history",
        threads: [
          {
            title: "Thread",
            threadId: "thread",
            selected: true,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: false, defaultSaveMarkdown: false },
            rename: null,
          },
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: false, defaultSaveMarkdown: false },
            rename: { draft: "Draft title", generating: false, saving: false, autoNameDisabled: false },
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
    changeInputValue(input, "New title");
    expect(updateRenameDraft).toHaveBeenCalledWith("editing", "New title");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelRenameThread).toHaveBeenCalledWith("editing");
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    expect(autoNameThread).toHaveBeenCalledWith("editing");
  });

  it("groups mixed pinned threads and routes the rightmost star action", () => {
    const parent = document.createElement("div");
    const setPinnedThread = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          {
            title: "Pinned",
            threadId: "pinned",
            selected: false,
            isPinned: true,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: false, defaultSaveMarkdown: false },
            rename: null,
          },
          {
            title: "Recent",
            threadId: "recent",
            selected: false,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: false, defaultSaveMarkdown: false },
            rename: null,
          },
        ],
      }),
      toolbarActions({ setPinnedThread }),
    );

    expect(parent.querySelector(".codex-panel__thread-group-divider")).not.toBeNull();
    const firstRow = expectPresent(parent.querySelector(".codex-panel__thread-row"));
    const actions = [...firstRow.querySelectorAll<HTMLButtonElement>(".codex-panel__thread-action")];
    expect(actions.at(-1)?.getAttribute("aria-label")).toBe("Unpin thread");
    expect(actions.at(-1)?.getAttribute("aria-pressed")).toBe("true");
    actions.at(-1)?.click();
    expect(setPinnedThread).toHaveBeenCalledWith("pinned", false);
  });

  it("adapts auto-name cancellation while loading", () => {
    const parent = document.createElement("div");
    const cancelAutoName = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: false, defaultSaveMarkdown: false },
            rename: { draft: "Draft title", generating: true, saving: false, autoNameDisabled: false },
          },
        ],
      }),
      toolbarActions({ cancelAutoName }),
    );

    const cancelAutoNameButton = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]'));
    cancelAutoNameButton.click();
    expect(cancelAutoName).toHaveBeenCalledWith("editing");
  });

  it("keeps chat navigation active while adapting archive confirmation", () => {
    const parent = document.createElement("div");
    const archiveThread = vi.fn();
    const resumeThread = vi.fn();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          {
            title: "Thread",
            threadId: "thread",
            selected: true,
            renameDisabled: false,
            archiveDisabled: false,
            archiveConfirm: { active: true, defaultSaveMarkdown: true },
            rename: null,
          },
        ],
      }),
      toolbarActions({ archiveThread, resumeThread }),
    );

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__archive-confirm"));
    const archiveActions = expectPresent(confirm.querySelector<HTMLElement>(".codex-panel__thread-actions"));
    const defaultArchiveButton = expectPresent(archiveActions.querySelector<HTMLButtonElement>(".codex-panel__archive-default"));
    const alternateArchiveButton = expectPresent(archiveActions.querySelector<HTMLButtonElement>(".codex-panel__archive-alternate"));
    expectPresent(confirm.querySelector<HTMLElement>(".codex-panel__thread")).click();
    expect(resumeThread).toHaveBeenCalledWith("thread");
    defaultArchiveButton.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    alternateArchiveButton.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", false);
  });

  it("renders shared history expansion as a nav-list item", () => {
    const parent = document.createElement("div");
    const loadMoreThreads = vi.fn();

    mountToolbar(parent, toolbarModel({ openPanel: "history", hasMoreThreads: true }), toolbarActions({ loadMoreThreads }));

    const loadMore = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loadMore.textContent).toBe("Load more threads");
    loadMore.click();
    expect(loadMoreThreads).toHaveBeenCalledOnce();

    mountToolbar(
      parent,
      toolbarModel({ openPanel: "history", hasMoreThreads: true, loadingMoreThreads: true }),
      toolbarActions({ loadMoreThreads }),
    );
    const loading = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loading.textContent).toBe("Loading more threads…");
    expect(loading.classList.contains("is-disabled")).toBe(true);
    loading.click();
    expect(loadMoreThreads).toHaveBeenCalledOnce();

    mountToolbar(
      parent,
      toolbarModel({ openPanel: "history", hasMoreThreads: true, threadListFetching: true }),
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

    mountToolbar(parent, toolbarModel({ openPanel: "history", threads: [], threadListLoading: true }), toolbarActions());

    expect(parent.textContent).toContain("Loading threads…");
    expect(parent.textContent).not.toContain("No threads");
  });

  it("renders thread list failures as non-navigation status", () => {
    const parent = document.createElement("div");

    mountToolbar(parent, toolbarModel({ openPanel: "history", threads: [], threadListError: "Could not load threads." }), toolbarActions());

    const status = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-list-status"));
    expect(status.textContent).toBe("Could not load threads.");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.className).toBe("codex-panel__thread-list-status");
    expect(status.classList.contains("codex-panel-ui__nav-item")).toBe(false);
    expect(parent.querySelector(".codex-panel__thread--error")).toBeNull();
  });
});

function toolbarModel(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    newChatDisabled: false,
    sideChatStartDisabled: false,
    compactDisabled: false,
    goalMutationDisabled: false,
    rateLimit: null,
    openPanel: null,
    threads: [
      {
        title: "Thread",
        threadId: "thread",
        selected: true,
        renameDisabled: false,
        archiveDisabled: false,
        archiveConfirm: { active: false, defaultSaveMarkdown: false },
        rename: null,
      },
    ],
    hasMoreThreads: false,
    threadListLoading: false,
    threadListFetching: false,
    loadingMoreThreads: false,
    threadListError: null,
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
  copyDebugDetails?: () => void;
  resumeThread?: (threadId: string) => void;
  loadMoreThreads?: () => void;
  startArchiveThread?: (threadId: string) => void;
  archiveThread?: (threadId: string, saveMarkdown: boolean) => void;
  startRenameThread?: (threadId: string) => void;
  updateRenameDraft?: (threadId: string, value: string) => void;
  saveRenameThread?: (threadId: string, value: string) => void;
  cancelRenameThread?: (threadId: string) => void;
  cancelAutoName?: (threadId: string) => void;
  autoNameThread?: (threadId: string) => void;
  setPinnedThread?: (threadId: string, isPinned: boolean) => void;
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
      setPinned: overrides.setPinnedThread ?? vi.fn(),
      archive: {
        start: overrides.startArchiveThread ?? vi.fn(),
        confirm: overrides.archiveThread ?? vi.fn(),
      },
      rename: {
        start: overrides.startRenameThread ?? vi.fn(),
        updateDraft: overrides.updateRenameDraft ?? vi.fn(),
        save: overrides.saveRenameThread ?? vi.fn(),
        cancel: overrides.cancelRenameThread ?? vi.fn(),
        cancelAutoName: overrides.cancelAutoName ?? vi.fn(),
        autoName: overrides.autoNameThread ?? vi.fn(),
      },
    },
  };
}
