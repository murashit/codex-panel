// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderThreadsView } from "../../../src/features/threads-view/renderer";
import {
  liveStateForSnapshots,
  selectedStateForSnapshots,
  threadRows,
  type ThreadsRowModel,
} from "../../../src/features/threads-view/state";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { OpenCodexPanelSnapshot } from "../../../src/runtime/open-panel-snapshot";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function openPanelSnapshot(
  overrides: Partial<{
    viewId: string;
    threadId: string | null;
    turnLifecycle: OpenCodexPanelSnapshot["turnLifecycle"];
    pendingApprovals: number;
    pendingUserInputs: number;
    hasComposerDraft: boolean;
    connected: boolean;
    lastFocused: boolean;
  }> = {},
): OpenCodexPanelSnapshot {
  return {
    viewId: "view",
    threadId: "thread",
    lastFocused: false,
    turnLifecycle: { kind: "idle" },
    pendingApprovals: 0,
    pendingUserInputs: 0,
    hasComposerDraft: false,
    connected: true,
    ...overrides,
  };
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    sessionId: "session",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
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

function rowFixture(overrides: Partial<ThreadsRowModel> = {}): ThreadsRowModel {
  const thread = overrides.thread ?? threadFixture({ id: "thread", name: "Thread" });
  const title = overrides.title ?? thread.name ?? thread.preview;
  return {
    thread,
    title,
    live: null,
    selected: false,
    rename: { active: false, draft: title, generating: false },
    archiveConfirm: { active: false, defaultSaveMarkdown: false },
    ...overrides,
  };
}

function threadsViewActions() {
  return {
    refresh: vi.fn(),
    openNewPanel: vi.fn(),
    openThread: vi.fn(),
    startRename: vi.fn(),
    updateRename: vi.fn(),
    saveRename: vi.fn(),
    cancelRename: vi.fn(),
    autoNameThread: vi.fn(),
    startArchive: vi.fn(),
    archiveThread: vi.fn(),
  };
}

describe("threads view renderer decisions", () => {
  it("prioritizes open panel live state per thread", () => {
    expect(
      liveStateForSnapshots([
        openPanelSnapshot({ viewId: "open", threadId: "thread" }),
        openPanelSnapshot({ viewId: "running", threadId: "thread", turnLifecycle: { kind: "running", turnId: "turn" } }),
        openPanelSnapshot({ viewId: "approval", threadId: "thread", pendingApprovals: 1 }),
        openPanelSnapshot({ viewId: "input", threadId: "thread", pendingUserInputs: 1 }),
      ]),
    ).toMatchObject({ status: "needs-input", label: "Needs input", viewId: "input", openPanels: 4 });

    expect(liveStateForSnapshots([openPanelSnapshot({ viewId: "draft", threadId: "thread", hasComposerDraft: true })])).toMatchObject({
      status: "draft",
      label: "Draft",
    });
    expect(liveStateForSnapshots([openPanelSnapshot({ viewId: "offline", threadId: "thread", connected: false })])).toMatchObject({
      status: "offline",
      label: "Offline",
    });
    expect(
      liveStateForSnapshots([openPanelSnapshot({ viewId: "none", threadId: null, turnLifecycle: { kind: "running", turnId: "turn" } })]),
    ).toBeNull();
  });

  it("marks a row selected when one open panel for the thread was last focused", () => {
    expect(selectedStateForSnapshots([openPanelSnapshot({ threadId: null, lastFocused: true })])).toBe(false);
    expect(selectedStateForSnapshots([openPanelSnapshot({ threadId: "thread", lastFocused: true })])).toBe(true);

    const rows = threadRows(
      [
        threadFixture({ id: "closed", preview: "Closed thread" }),
        threadFixture({ id: "focused", preview: "Focused thread", updatedAt: 2 }),
      ],
      [openPanelSnapshot({ viewId: "view-focused", threadId: "focused", lastFocused: true })],
      new Map(),
    );

    expect(rows.find((row) => row.thread.id === "focused")?.selected).toBe(true);
    expect(rows.find((row) => row.thread.id === "closed")?.selected).toBe(false);
  });

  it("renders thread rows with live state and routes open actions", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const rows = threadRows(
      [threadFixture({ id: "closed", preview: "Closed thread" }), threadFixture({ id: "open", preview: "Open thread", updatedAt: 2 })],
      [openPanelSnapshot({ viewId: "view-open", threadId: "open", pendingApprovals: 1, lastFocused: true })],
      new Map(),
    );

    renderThreadsView(parent, { status: "2 threads", loading: false, rows }, actions);

    expect(parent.querySelector(".codex-panel-threads__badge")).toBeNull();
    const row = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row--approval"));
    expect(row.classList.contains("codex-panel-threads__row--selected")).toBe(true);
    expect(row.getAttribute("title")).toBeNull();
    const toolbarButtons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel-threads__toolbar-button")];
    expect(toolbarButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Open new panel", "Refresh threads"]);
    const refresh = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Refresh threads"]'));
    expect(refresh.classList.contains("codex-panel-threads__toolbar-button")).toBe(true);
    refresh.click();
    expect(actions.refresh).toHaveBeenCalledOnce();
    const openNewPanel = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Open new panel"]'));
    expect(openNewPanel.classList.contains("codex-panel-threads__toolbar-button")).toBe(true);
    expect(openNewPanel.classList.contains("codex-panel-threads__row-button")).toBe(false);
    openNewPanel.click();
    expect(actions.openNewPanel).toHaveBeenCalledOnce();
    row.click();
    expect(actions.openThread).toHaveBeenCalledWith("open");
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(actions.openThread).toHaveBeenCalledTimes(2);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Focus open panel"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Open in new panel"]')).toBeNull();
  });

  it("renders threads view archive confirmation with the default action on the right", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      archiveConfirm: { active: true, defaultSaveMarkdown: false },
    });

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__archive-confirm"));
    const archiveButtons = [
      ...confirm.querySelectorAll<HTMLButtonElement>(".codex-panel-threads__archive-alternate, .codex-panel-threads__archive-default"),
    ];
    expect(archiveButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Save and archive thread",
      "Archive thread without saving",
    ]);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();
    archiveButtons[0]?.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", true);
    archiveButtons[1]?.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", false);
  });

  it("starts threads view archive confirmation before archiving", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture();

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);
    parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();

    expect(actions.startArchive).toHaveBeenCalledWith("thread");
    expect(actions.archiveThread).not.toHaveBeenCalled();
  });

  it("renders rename rows and saves entered values", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: false },
    });

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    const input = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input"));
    changeInputValue(input, "New name");
    expect(actions.updateRename).toHaveBeenCalledWith("thread", "New name");

    renderThreadsView(
      parent,
      { status: "1 thread", loading: false, rows: [{ ...row, rename: { active: true, draft: "New name", generating: false } }] },
      actions,
    );
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")).dispatchEvent(new FocusEvent("blur"));
    expect(actions.saveRename).toHaveBeenCalledWith("thread", "New name");

    expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row")).click();
    expect(actions.openThread).not.toHaveBeenCalled();
  });

  it("renders threads view rename actions inline with auto-name", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row = rowFixture({
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: false },
    });

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    expect(parent.querySelector<HTMLElement>(".codex-panel-threads__rename-form")).toBeTruthy();
    const actionsGroup = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__rename-actions"));
    expect(actionsGroup.querySelectorAll(".codex-panel-threads__row-button")).toHaveLength(1);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    expect(actions.autoNameThread).toHaveBeenCalledWith("thread");
  });

  it("renders threads view rename auto-name loading state", () => {
    const parent = document.createElement("div");
    const row = rowFixture({
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      rename: { active: true, draft: "Old name", generating: true },
    });

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, threadsViewActions());

    expect(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(false);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
  });
});
