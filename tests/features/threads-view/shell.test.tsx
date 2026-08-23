// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../src/domain/threads/model";
import { renderThreadsViewShell } from "../../../src/features/threads-view/shell.dom";
import { type ThreadsRowModel, type ThreadsViewPanelActivity, threadRows } from "../../../src/features/threads-view/state";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function panelActivity(overrides: Partial<ThreadsViewPanelActivity> = {}): ThreadsViewPanelActivity {
  return {
    threadId: "thread",
    selected: false,
    pending: false,
    running: false,
    ...overrides,
  };
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

function rowFixture(overrides: Partial<ThreadsRowModel> = {}): ThreadsRowModel {
  const threadId = overrides.threadId ?? "thread";
  const title = overrides.title ?? "Thread";
  return {
    threadId,
    title,
    live: null,
    lifecycleBusy: false,
    selected: false,
    isPinned: false,
    rename: { active: false, draft: title, generating: false, saving: false, autoNameDisabled: true },
    archiveConfirm: { active: false, defaultSaveMarkdown: false },
    ...overrides,
  };
}

function threadsViewActions() {
  return {
    refresh: vi.fn(),
    loadMore: vi.fn(),
    openNewPanel: vi.fn(),
    openThread: vi.fn(),
    startRename: vi.fn(),
    updateRename: vi.fn(),
    saveRename: vi.fn(),
    cancelRename: vi.fn(),
    cancelAutoName: vi.fn(),
    autoNameThread: vi.fn(),
    setThreadPinned: vi.fn(),
    startArchive: vi.fn(),
    archiveThread: vi.fn(),
  };
}

describe("threads view renderer decisions", () => {
  it("renders an initial load failure as status instead of a navigation row or empty state", () => {
    const parent = document.createElement("div");

    renderThreadsViewShell(
      parent,
      { status: { kind: "error", message: "Could not load threads." }, loading: false, rows: [] },
      threadsViewActions(),
    );

    const status = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__status"));
    expect(status.getAttribute("role")).toBe("status");
    expect(status.className).toBe("codex-panel-threads__state codex-panel-threads__status");
    expect(parent.querySelector(".codex-panel-threads__empty")).toBeNull();
  });

  it("reserves the empty state for a successfully loaded empty list", () => {
    const parent = document.createElement("div");

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [] }, threadsViewActions());

    expect(parent.querySelector(".codex-panel-threads__empty")).not.toBeNull();
    expect(parent.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("uses one state row layout for loading and empty thread lists", () => {
    const parent = document.createElement("div");

    renderThreadsViewShell(
      parent,
      { status: { kind: "loading", message: "Loading threads..." }, loading: true, rows: [] },
      threadsViewActions(),
    );

    const loading = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__state"));
    expect(loading.classList.contains("codex-panel-threads__status")).toBe(true);
    expect(loading.getAttribute("role")).toBe("status");

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [] }, threadsViewActions());

    const empty = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__state"));
    expect(empty.classList.contains("codex-panel-threads__empty")).toBe(true);
    expect(empty.getAttribute("role")).toBeNull();
  });

  it("prioritizes open panel live state per thread", () => {
    expect(
      threadRows(
        [threadFixture({ id: "thread" })],
        [
          panelActivity({ threadId: "thread" }),
          panelActivity({ threadId: "thread", running: true }),
          panelActivity({ threadId: "thread", pending: true }),
        ],
        new Map(),
      )[0]?.live,
    ).toMatchObject({ status: "pending" });

    expect(threadRows([threadFixture({ id: "thread" })], [panelActivity({ threadId: "thread" })], new Map())[0]?.live).toMatchObject({
      status: "open",
    });
    expect(
      threadRows([threadFixture({ id: "thread" })], [panelActivity({ threadId: null, running: true })], new Map())[0]?.live,
    ).toBeNull();
  });

  it("marks a row selected when one open panel for the thread was last focused", () => {
    const rows = threadRows(
      [
        threadFixture({ id: "closed", preview: "Closed thread" }),
        threadFixture({ id: "focused", preview: "Focused thread", updatedAt: 2 }),
      ],
      [panelActivity({ threadId: "focused", selected: true })],
      new Map(),
    );

    expect(rows.find((row) => row.threadId === "focused")?.selected).toBe(true);
    expect(rows.find((row) => row.threadId === "closed")?.selected).toBe(false);
  });

  it("renders thread rows with live state and routes open actions", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const rows = threadRows(
      [threadFixture({ id: "closed", preview: "Closed thread" }), threadFixture({ id: "open", preview: "Open thread", updatedAt: 2 })],
      [panelActivity({ threadId: "open", pending: true, selected: true })],
      new Map(),
    );

    renderThreadsViewShell(parent, { status: null, loading: false, rows }, actions);

    const main = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row--pending"));
    expect(main.textContent).toContain("Open thread");
    const toolbarButtons = [...parent.querySelectorAll<HTMLElement>(".codex-panel-threads__toolbar-button")];
    expect(toolbarButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Open new panel", "Refresh threads"]);
    const refresh = expectPresent(parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]'));
    refresh.click();
    expect(actions.refresh).toHaveBeenCalledOnce();
    const openNewPanel = expectPresent(parent.querySelector<HTMLElement>('[aria-label="Open new panel"]'));
    openNewPanel.click();
    expect(actions.openNewPanel).toHaveBeenCalledOnce();
    expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).click();
    expect(actions.startRename).toHaveBeenCalledWith("open", "Open thread");
    main.click();
    expect(actions.openThread).toHaveBeenCalledWith("open");
  });

  it("groups mixed pinned rows and routes the rightmost star action", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const rows = [
      rowFixture({ threadId: "pinned", title: "Pinned thread", isPinned: true }),
      rowFixture({ threadId: "recent", title: "Recent thread" }),
    ];

    renderThreadsViewShell(parent, { status: null, loading: false, rows }, actions);

    expect(parent.querySelector(".codex-panel-threads__group-divider")).not.toBeNull();
    const firstRowActions = expectPresent(parent.querySelector(".codex-panel-threads__actions"));
    const buttons = [...firstRowActions.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("Unpin thread");
    expect(buttons.at(-1)?.getAttribute("aria-pressed")).toBe("true");
    buttons.at(-1)?.click();
    expect(actions.setThreadPinned).toHaveBeenCalledWith("pinned", false);
  });

  it("keeps row navigation active while routing archive confirmation actions", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      archiveConfirm: { active: true, defaultSaveMarkdown: false },
    });

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [row] }, actions);

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__archive-confirm"));
    const defaultArchiveButton = expectPresent(confirm.querySelector<HTMLButtonElement>(".codex-panel-threads__archive-default"));
    const alternateArchiveButton = expectPresent(confirm.querySelector<HTMLButtonElement>(".codex-panel-threads__archive-alternate"));
    const main = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row-main"));
    main.click();
    expect(actions.openThread).toHaveBeenCalledWith("thread");
    defaultArchiveButton.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", false);
    alternateArchiveButton.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", true);
  });

  it("starts threads view archive confirmation before archiving", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture();

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [row] }, actions);
    parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();

    expect(actions.startArchive).toHaveBeenCalledWith("thread");
    expect(actions.archiveThread).not.toHaveBeenCalled();
  });

  it("adapts the inline rename editor while keeping row navigation inactive", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: false, saving: false, autoNameDisabled: false },
    });

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [row] }, actions);

    const input = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input"));
    changeInputValue(input, "New name");
    expect(actions.updateRename).toHaveBeenCalledWith("thread", "New name");

    expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row-main")).click();
    expect(actions.openThread).not.toHaveBeenCalled();
  });

  it("renders threads view rename actions inline with auto-name", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: false, saving: false, autoNameDisabled: false },
    });

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [row] }, actions);

    expect(parent.querySelector<HTMLElement>(".codex-panel-threads__rename-form")).toBeTruthy();
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    expect(actions.autoNameThread).toHaveBeenCalledWith("thread");
  });

  it("renders threads view rename auto-name loading state", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: true, saving: false, autoNameDisabled: false },
    });

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [row] }, actions);

    expect(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(true);
    const cancelAutoName = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]'));
    expect(cancelAutoName.disabled).toBe(false);
    cancelAutoName.click();
    expect(actions.cancelAutoName).toHaveBeenCalledWith("thread");
  });

  it("disables history expansion during any shared thread fetch", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();

    renderThreadsViewShell(parent, { status: null, loading: false, fetching: true, hasMore: true, rows: [rowFixture()] }, actions);

    const loadMore = expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more"));
    expect(loadMore.textContent).toBe("Load more threads");
    expect(loadMore.disabled).toBe(true);
    loadMore.click();
    expect(actions.loadMore).not.toHaveBeenCalled();
  });
});
