// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { ToolbarThreadRow, ToolbarViewModel } from "../../../../../src/features/chat/ui/toolbar/model";
import { Toolbar, type ToolbarActions } from "../../../../../src/features/chat/ui/toolbar/toolbar";
import { renderUiRoot } from "../../../../../src/shared/ui/preact-root.dom";
import { changeInputValue, installObsidianDomShims } from "../../../../support/dom";
import { toolbarActionsFixture } from "../../support/toolbar-actions";

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
    const actions = toolbarActionsFixture();

    mountToolbar(parent, toolbarModel({ openPanel: "chat-actions" }), actions);

    const items = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")];
    expect(items).toHaveLength(4);
    items[0]?.click();
    items[1]?.click();
    items[2]?.click();
    items[3]?.click();
    expect(actions.chat.startNewThread).toHaveBeenCalledOnce();
    expect(actions.chat.startSideChat).toHaveBeenCalledOnce();
    expect(actions.chat.compactContext).toHaveBeenCalledOnce();
    expect(actions.chat.setGoal).toHaveBeenCalledOnce();

    mountToolbar(parent, toolbarModel({ openPanel: "chat-actions", newChatDisabled: true }), actions);
    const disabledStart = expectPresent(
      [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__chat-actions-panel-item")].find(
        (item) => item.textContent === "Start new chat",
      ),
    );
    disabledStart.click();
    expect(actions.chat.startNewThread).toHaveBeenCalledOnce();
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
      toolbarActionsFixture(),
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
    const actions = toolbarActionsFixture();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "status",
        diagnostics: [
          { title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/1.2.3" }] },
          { title: "Runtime Checks", rows: [{ label: "diagnostics", value: "model/list failed", level: "error" }] },
        ],
      }),
      actions,
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
    expect(actions.status.refreshStatus).toHaveBeenCalled();
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
      toolbarActionsFixture(),
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
    const actions = toolbarActionsFixture();

    mountToolbar(parent, toolbarModel({ openPanel: "status" }), actions);

    parent.querySelectorAll<HTMLButtonElement>(".codex-panel__status-panel-item")[2]?.click();
    expect(actions.status.copyDebugDetails).toHaveBeenCalledOnce();
  });

  it("adapts thread row controls and the inline editor to toolbar actions", () => {
    const parent = document.createElement("div");
    const actions = toolbarActionsFixture();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          toolbarThreadRowFixture({
            title: "Thread",
            threadId: "thread",
            selected: true,
          }),
          toolbarThreadRowFixture({
            title: "Editing",
            threadId: "editing",
            selected: false,
            rename: { draft: "Draft title", generating: false, saving: false, autoNameDisabled: false },
          }),
        ],
      }),
      actions,
    );

    const renameButton = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]'));
    renameButton.click();
    expect(actions.threads.rename.start).toHaveBeenCalledWith("thread");
    const threadRow = parent.querySelector(".codex-panel__thread-row");
    expect(threadRow?.classList.contains("codex-panel__thread-row--selected")).toBe(true);

    const input = parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    if (!input) throw new Error("Missing thread rename input");
    expect(input.value).toBe("Draft title");
    changeInputValue(input, "New title");
    expect(actions.threads.rename.updateDraft).toHaveBeenCalledWith("editing", "New title");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(actions.threads.rename.save).toHaveBeenCalledWith("editing", "New title");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(actions.threads.rename.cancel).toHaveBeenCalledWith("editing");
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    expect(actions.threads.rename.autoName).toHaveBeenCalledWith("editing");
  });

  it("groups mixed pinned threads and routes the rightmost star action", () => {
    const parent = document.createElement("div");
    const actions = toolbarActionsFixture();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          toolbarThreadRowFixture({
            title: "Pinned",
            threadId: "pinned",
            selected: false,
            isPinned: true,
          }),
          toolbarThreadRowFixture({
            title: "Recent",
            threadId: "recent",
            selected: false,
          }),
        ],
      }),
      actions,
    );

    expect(parent.querySelector(".codex-panel__thread-group-divider")).not.toBeNull();
    const firstRow = expectPresent(parent.querySelector(".codex-panel__thread-row"));
    const rowActions = [...firstRow.querySelectorAll<HTMLButtonElement>(".codex-panel__thread-action")];
    expect(rowActions.at(-1)?.getAttribute("aria-label")).toBe("Unpin thread");
    expect(rowActions.at(-1)?.getAttribute("aria-pressed")).toBe("true");
    rowActions.at(-1)?.click();
    expect(actions.threads.setPinned).toHaveBeenCalledWith("pinned", false);
  });

  it("adapts auto-name cancellation while loading", () => {
    const parent = document.createElement("div");
    const actions = toolbarActionsFixture();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          toolbarThreadRowFixture({
            title: "Editing",
            threadId: "editing",
            selected: false,
            rename: { draft: "Draft title", generating: true, saving: false, autoNameDisabled: false },
          }),
        ],
      }),
      actions,
    );

    const cancelAutoNameButton = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]'));
    expect(cancelAutoNameButton.closest(".codex-panel__thread-row--auto-name-running")).not.toBeNull();
    cancelAutoNameButton.click();
    expect(actions.threads.rename.cancelAutoName).toHaveBeenCalledWith("editing");
  });

  it("keeps chat navigation active while adapting archive confirmation", () => {
    const parent = document.createElement("div");
    const actions = toolbarActionsFixture();

    mountToolbar(
      parent,
      toolbarModel({
        openPanel: "history",
        threads: [
          toolbarThreadRowFixture({
            title: "Thread",
            threadId: "thread",
            selected: true,
            archiveConfirm: { active: true, defaultSaveMarkdown: true },
          }),
        ],
      }),
      actions,
    );

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__archive-confirm"));
    const archiveActions = expectPresent(confirm.querySelector<HTMLElement>(".codex-panel__thread-actions"));
    const defaultArchiveButton = expectPresent(archiveActions.querySelector<HTMLButtonElement>(".codex-panel__archive-default"));
    const alternateArchiveButton = expectPresent(archiveActions.querySelector<HTMLButtonElement>(".codex-panel__archive-alternate"));
    expectPresent(confirm.querySelector<HTMLElement>(".codex-panel__thread")).click();
    expect(actions.threads.resume).toHaveBeenCalledWith("thread");
    defaultArchiveButton.click();
    expect(actions.threads.archive.confirm).toHaveBeenCalledWith("thread", true);
    alternateArchiveButton.click();
    expect(actions.threads.archive.confirm).toHaveBeenCalledWith("thread", false);
  });

  it("renders shared history expansion as a nav-list item", () => {
    const parent = document.createElement("div");
    const actions = toolbarActionsFixture();

    mountToolbar(parent, toolbarModel({ openPanel: "history", hasMoreThreads: true }), actions);

    const loadMore = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loadMore.textContent).toBe("Load more threads");
    loadMore.click();
    expect(actions.threads.loadMore).toHaveBeenCalledOnce();

    mountToolbar(parent, toolbarModel({ openPanel: "history", hasMoreThreads: true, loadingMoreThreads: true }), actions);
    const loading = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(loading.textContent).toBe("Loading more threads…");
    expect(loading.classList.contains("is-disabled")).toBe(true);
    loading.click();
    expect(actions.threads.loadMore).toHaveBeenCalledOnce();

    mountToolbar(parent, toolbarModel({ openPanel: "history", hasMoreThreads: true, threadListFetching: true }), actions);
    const refreshing = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread--load-more"));
    expect(refreshing.textContent).toBe("Load more threads");
    expect(refreshing.classList.contains("is-disabled")).toBe(true);
    refreshing.click();
    expect(actions.threads.loadMore).toHaveBeenCalledOnce();
  });

  it("does not report an empty history while its first page is loading", () => {
    const parent = document.createElement("div");

    mountToolbar(parent, toolbarModel({ openPanel: "history", threads: [], threadListLoading: true }), toolbarActionsFixture());

    expect(parent.textContent).toContain("Loading threads…");
    expect(parent.textContent).not.toContain("No threads");
  });

  it("renders thread list failures as non-navigation status", () => {
    const parent = document.createElement("div");

    mountToolbar(
      parent,
      toolbarModel({ openPanel: "history", threads: [], threadListError: "Could not load threads." }),
      toolbarActionsFixture(),
    );

    const status = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-list-status"));
    expect(status.textContent).toBe("Could not load threads.");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.classList.contains("codex-panel-ui__nav-item")).toBe(false);
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
    threads: [toolbarThreadRowFixture()],
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

function toolbarThreadRowFixture(overrides: Partial<ToolbarThreadRow> = {}): ToolbarThreadRow {
  return {
    title: "Thread",
    threadId: "thread",
    selected: true,
    renameDisabled: false,
    archiveDisabled: false,
    archiveConfirm: { active: false, defaultSaveMarkdown: false },
    rename: null,
    ...overrides,
  };
}
