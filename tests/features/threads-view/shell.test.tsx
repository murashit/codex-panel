// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { Thread } from "../../../src/domain/threads/model";
import { renderThreadsViewShell, unmountThreadsViewShell } from "../../../src/features/threads-view/shell.dom";
import { type ThreadsRowModel, type ThreadsViewPanelActivity, threadRows } from "../../../src/features/threads-view/state";
import { installObsidianDomShims } from "../../support/dom";
import { panelThreadFixture } from "../../support/panel-thread";

installObsidianDomShims();

function mountParent(): HTMLElement {
  const parent = document.createElement("div");
  onTestFinished(() => unmountThreadsViewShell(parent));
  return parent;
}

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
    unread: false,
    ...overrides,
  };
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id: "thread",
    ...overrides,
  });
}

function rowFixture(overrides: Partial<ThreadsRowModel> = {}): ThreadsRowModel {
  const threadId = overrides.threadId ?? "thread";
  const title = overrides.title ?? "Thread";
  return {
    threadId,
    title,
    live: null,
    archiveDisabled: false,
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
  it.each([
    { kind: "error", message: "Could not load threads." },
    { kind: "loading", message: "Loading threads..." },
  ] as const)("announces $kind status instead of an empty list", ({ kind, message }) => {
    const parent = mountParent();

    renderThreadsViewShell(parent, { status: { kind, message }, loading: kind === "loading", rows: [] }, threadsViewActions());

    const status = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__status"));
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe(message);
    expect(parent.querySelector(".codex-panel-threads__empty")).toBeNull();
  });

  it("reserves the empty state for a successfully loaded empty list", () => {
    const parent = mountParent();

    renderThreadsViewShell(parent, { status: null, loading: false, rows: [] }, threadsViewActions());

    expect(parent.querySelector(".codex-panel-threads__empty")).not.toBeNull();
    expect(parent.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("shows pending, running, and idle states for the owning panel", () => {
    expect(
      threadRows(
        [threadFixture({ id: "thread" })],
        [panelActivity({ threadId: "thread", pending: true, running: true, unread: true })],
        new Map(),
      )[0]?.live,
    ).toMatchObject({ status: "pending" });

    expect(
      threadRows([threadFixture({ id: "thread" })], [panelActivity({ threadId: "thread", running: true, unread: true })], new Map())[0]
        ?.live,
    ).toMatchObject({ status: "running" });
    expect(threadRows([threadFixture({ id: "thread" })], [panelActivity({ threadId: "thread" })], new Map())[0]?.live).toMatchObject({
      status: "open",
    });
    expect(
      threadRows([threadFixture({ id: "thread" })], [panelActivity({ threadId: null, running: true })], new Map())[0]?.live,
    ).toBeNull();
  });

  it("shows unread only for open panels without changing selection or row actions", () => {
    const parent = mountParent();
    const rows = threadRows([threadFixture()], [panelActivity({ unread: true, selected: true })], new Map());
    expect(rows[0]?.live).toEqual({ status: "unread" });
    renderThreadsViewShell(parent, { status: null, loading: false, rows }, threadsViewActions());
    expect(parent.querySelector(".codex-panel-threads__row--unread")).not.toBeNull();
    expect(parent.querySelector(".is-selected")).not.toBeNull();
    expect(parent.querySelectorAll(".codex-panel-threads__row-button")).toHaveLength(3);
    expect(threadRows([threadFixture()], [], new Map())[0]?.live).toBeNull();
  });

  it("renders live thread rows and toolbar controls", () => {
    const parent = mountParent();
    const rows = threadRows(
      [threadFixture({ id: "closed", preview: "Closed thread" }), threadFixture({ id: "open", preview: "Open thread", updatedAt: 2 })],
      [panelActivity({ threadId: "open", pending: true, selected: true })],
      new Map(),
    );

    renderThreadsViewShell(parent, { status: null, loading: false, rows }, threadsViewActions());

    const main = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row--pending"));
    expect(main.textContent).toContain("Open thread");
    const toolbarButtons = [...parent.querySelectorAll<HTMLElement>(".codex-panel-threads__toolbar-button")];
    expect(toolbarButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Open new panel", "Refresh threads"]);
  });

  it("groups mixed pinned rows and routes the rightmost star action", () => {
    const parent = mountParent();
    const actions = threadsViewActions();
    const rows = [
      rowFixture({ threadId: "pinned", title: "Pinned thread", isPinned: true }),
      rowFixture({ threadId: "recent", title: "Recent thread" }),
    ];

    renderThreadsViewShell(parent, { status: null, loading: false, rows }, actions);

    expect(parent.querySelector(".codex-panel-threads__group-divider")).not.toBeNull();
    const firstRowActions = expectPresent(parent.querySelector(".codex-panel-ui__nav-row-actions"));
    const buttons = [...firstRowActions.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("Unpin thread");
    expect(buttons.at(-1)?.getAttribute("aria-pressed")).toBe("true");
    buttons.at(-1)?.click();
    expect(actions.setThreadPinned).toHaveBeenCalledWith("pinned", false);
  });

  it("disables history expansion during any shared thread fetch", () => {
    const parent = mountParent();
    const actions = threadsViewActions();

    renderThreadsViewShell(parent, { status: null, loading: false, fetching: true, hasMore: true, rows: [rowFixture()] }, actions);

    const loadMore = expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more"));
    expect(loadMore.textContent).toBe("Load more threads");
    expect(loadMore.disabled).toBe(true);
    loadMore.click();
    expect(actions.loadMore).not.toHaveBeenCalled();
  });
});
