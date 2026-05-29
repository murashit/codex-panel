// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { CodexChatView } from "../src/features/chat/view";
import type { Thread } from "../src/generated/app-server/v2/Thread";
import { installObsidianDomShims } from "./features/chat/ui/dom-test-helpers";

installObsidianDomShims();

describe("CodexPanelPlugin boot restored panel loading", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("loads restored Codex panel leaves after startup without blocking onload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    await plugin.onload();

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
  });

  it("cancels pending boot panel loads on unload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf]);

    await plugin.onload();
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("loads and focuses a deferred restored panel before opening another panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    const { CodexChatView } = await import("../src/features/chat/view");
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = chatView(CodexChatView, restoredLeaf);
    });

    await plugin.openThreadInAvailableView("thread-1");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(restoredLeaf.view).toBeInstanceOf(CodexChatView);
  });

  it("focuses an already open thread before reusing an empty panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const openLeaf = leaf();
    openLeaf.view = chatView(CodexChatView, openLeaf);
    const openView = openLeaf.view as CodexChatView;
    vi.spyOn(openView, "openPanelSnapshot").mockReturnValue({
      viewId: "open-view",
      threadId: "thread-1",
      turnLifecycle: { kind: "idle" },
      pendingApprovals: 0,
      pendingUserInputs: 0,
      hasComposerDraft: false,
      connected: true,
    });
    vi.spyOn(openView, "focusThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const emptyView = emptyLeaf.view as CodexChatView;
    const openEmptyThread = vi.spyOn(emptyView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([openLeaf, emptyLeaf]);

    await plugin.openThreadInAvailableView("thread-1");

    expect((plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([openLeaf]);
    expect(openEmptyThread).not.toHaveBeenCalled();
  });

  it("reuses an idle empty panel before opening a new panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const busyLeaf = leaf();
    busyLeaf.view = chatView(CodexChatView, busyLeaf);
    const busyView = busyLeaf.view as CodexChatView;
    vi.spyOn(busyView, "openPanelSnapshot").mockReturnValue({
      viewId: "busy-view",
      threadId: "other-thread",
      turnLifecycle: { kind: "idle" },
      pendingApprovals: 0,
      pendingUserInputs: 0,
      hasComposerDraft: false,
      connected: true,
    });
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const emptyView = emptyLeaf.view as CodexChatView;
    vi.spyOn(emptyView, "openPanelSnapshot").mockReturnValue({
      viewId: "empty-view",
      threadId: null,
      turnLifecycle: { kind: "idle" },
      pendingApprovals: 0,
      pendingUserInputs: 0,
      hasComposerDraft: false,
      connected: true,
    });
    const openEmptyThread = vi.spyOn(emptyView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([busyLeaf, emptyLeaf]);

    await plugin.openThreadInAvailableView("thread-1");

    expect(openEmptyThread).toHaveBeenCalledWith("thread-1");
  });

  it("opens picker Enter selections in the most recent panel when the thread is not already open", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const olderLeaf = leaf();
    olderLeaf.view = chatView(CodexChatView, olderLeaf);
    const olderView = olderLeaf.view as CodexChatView;
    const openOlderThread = vi.spyOn(olderView, "openThread").mockResolvedValue(undefined);
    const currentLeaf = leaf();
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const currentView = currentLeaf.view as CodexChatView;
    const openCurrentThread = vi.spyOn(currentView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([olderLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await plugin.openThreadInCurrentView("thread-1");

    expect(openCurrentThread).toHaveBeenCalledWith("thread-1");
    expect(openOlderThread).not.toHaveBeenCalled();
  });

  it("opens picker Enter selections in the active Codex panel before the right-sidebar fallback", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const fallbackLeaf = leaf();
    fallbackLeaf.view = chatView(CodexChatView, fallbackLeaf);
    const fallbackView = fallbackLeaf.view as CodexChatView;
    const openFallbackThread = vi.spyOn(fallbackView, "openThread").mockResolvedValue(undefined);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    const openActiveThread = vi.spyOn(activeView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([fallbackLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(fallbackLeaf);

    await plugin.openThreadInCurrentView("thread-1");

    expect(openActiveThread).toHaveBeenCalledWith("thread-1");
    expect(openFallbackThread).not.toHaveBeenCalled();
  });

  it("focuses an already open thread before picker Enter overwrites the current panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const openLeaf = leaf();
    openLeaf.view = chatView(CodexChatView, openLeaf);
    const openView = openLeaf.view as CodexChatView;
    vi.spyOn(openView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "open-view", threadId: "thread-1" }));
    const focusOpenThread = vi.spyOn(openView, "focusThread").mockResolvedValue(undefined);
    const currentLeaf = leaf();
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const currentView = currentLeaf.view as CodexChatView;
    const openCurrentThread = vi.spyOn(currentView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([openLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await plugin.openThreadInCurrentView("thread-1");

    expect(focusOpenThread).toHaveBeenCalledWith("thread-1");
    expect(openCurrentThread).not.toHaveBeenCalled();
  });

  it("opens picker Enter selections in a deferred current panel even when it restored another thread", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread", threadTitle: "Restored thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../src/features/chat/view");
    const view = chatView(CodexChatView, restoredLeaf);
    const openThread = vi.spyOn(view, "openThread").mockResolvedValue(undefined);
    const focusThread = vi.spyOn(view, "focusThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = view;
    });

    await plugin.openThreadInCurrentView("selected-thread");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(openThread).toHaveBeenCalledWith("selected-thread");
    expect(focusThread).not.toHaveBeenCalled();
  });

  it("opens a thread in a new panel without a separate pre-connect", async () => {
    const newLeaf = leaf();
    const plugin = await pluginWithLeaves([]);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../src/features/chat/view");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
    });
    const connect = vi.spyOn(view, "connect").mockResolvedValue(undefined);
    const focusComposer = vi.spyOn(view, "focusComposer").mockImplementation(() => undefined);
    const openThread = vi.spyOn(view, "openThread").mockResolvedValue(undefined);

    await plugin.openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(openThread).toHaveBeenCalledWith("thread-1");
  });

  it("activates the active Codex panel instead of the first existing panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstView = firstLeaf.view as CodexChatView;
    const connectFirst = vi.spyOn(firstView, "connect").mockResolvedValue(undefined);
    const focusFirst = vi.spyOn(firstView, "focusComposer").mockImplementation(() => undefined);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    const connectActive = vi.spyOn(activeView, "connect").mockResolvedValue(undefined);
    const focusActive = vi.spyOn(activeView, "focusComposer").mockImplementation(() => undefined);
    const plugin = await pluginWithLeaves([firstLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);

    await expect(plugin.activateView()).resolves.toBe(activeView);

    expect((plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([activeLeaf]);
    expect(connectActive).toHaveBeenCalledOnce();
    expect(focusActive).toHaveBeenCalledOnce();
    expect(connectFirst).not.toHaveBeenCalled();
    expect(focusFirst).not.toHaveBeenCalled();
    expect((plugin.app.workspace.ensureSideLeaf as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("opens an empty new panel from the threads view action", async () => {
    const newLeaf = leaf();
    const plugin = await pluginWithLeaves([]);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../src/features/chat/view");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
    });
    const connect = vi.spyOn(view, "connect").mockResolvedValue(undefined);
    const focusComposer = vi.spyOn(view, "focusComposer").mockImplementation(() => undefined);
    const openThread = vi.spyOn(view, "openThread").mockResolvedValue(undefined);

    await plugin.openNewPanel();

    expect(connect).toHaveBeenCalledOnce();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(openThread).not.toHaveBeenCalled();
  });

  it("refreshes shared thread lists after archive lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi.spyOn(plugin, "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    plugin.notifyThreadArchived("thread-1");

    expect(refreshSharedThreadList).toHaveBeenCalledOnce();
  });

  it("closes matching chat panels only when archive notification requests it", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn(matchingLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn(otherLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    const plugin = await pluginWithLeaves([matchingLeaf, otherLeaf]);
    vi.spyOn(plugin, "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    plugin.notifyThreadArchived("thread-1");

    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();

    plugin.notifyThreadArchived("thread-1", { closeOpenPanels: true });

    expect(matchingLeaf.detach).toHaveBeenCalledOnce();
    expect(otherLeaf.detach).not.toHaveBeenCalled();
  });

  it("refreshes shared thread lists after rename lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi.spyOn(plugin, "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    plugin.notifyThreadRenamed("thread-1", "Renamed thread");

    expect(refreshSharedThreadList).toHaveBeenCalledOnce();
  });

  it("single-flights shared thread list refreshes and caches successful results", async () => {
    const plugin = await pluginWithLeaves([]);
    let resolveThreads!: (threads: Thread[]) => void;
    const fetchThreads = vi.fn(
      () =>
        new Promise<Thread[]>((resolve) => {
          resolveThreads = resolve;
        }),
    );
    const secondFetch = vi.fn().mockResolvedValue([thread("second")]);

    const first = plugin.refreshThreadList(fetchThreads);
    const second = plugin.refreshThreadList(secondFetch);

    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(secondFetch).not.toHaveBeenCalled();
    resolveThreads([thread("first")]);

    await expect(first).resolves.toEqual([thread("first")]);
    await expect(second).resolves.toEqual([thread("first")]);
    expect(plugin.cachedThreadList()).toEqual([thread("first")]);
  });

  it("keeps the previous shared thread list when refresh fails", async () => {
    const plugin = await pluginWithLeaves([]);
    await plugin.refreshThreadList(() => Promise.resolve([thread("cached")]));

    await expect(plugin.refreshThreadList(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    expect(plugin.cachedThreadList()).toEqual([thread("cached")]);
  });

  it("refreshes shared thread lists from a connected chat panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const disconnectedLeaf = leaf();
    disconnectedLeaf.view = chatView(CodexChatView, disconnectedLeaf);
    const disconnectedView = disconnectedLeaf.view as CodexChatView;
    vi.spyOn(disconnectedView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "disconnected", connected: false }));
    const disconnectedRefresh = vi.spyOn(disconnectedView, "refreshSharedThreadList").mockResolvedValue(undefined);

    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    const connectedRefresh = vi.spyOn(connectedView, "refreshSharedThreadList").mockResolvedValue(undefined);

    const plugin = await pluginWithLeaves([disconnectedLeaf, connectedLeaf]);

    plugin.refreshSharedThreadListFromOpenSurface();

    expect(disconnectedRefresh).not.toHaveBeenCalled();
    expect(connectedRefresh).toHaveBeenCalledOnce();
  });
});

async function pluginWithLeaves(leaves: ReturnType<typeof leaf>[]) {
  const { default: CodexPanelPlugin } = await import("../src/main");
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  return new CodexPanelPlugin(
    {
      vault: {
        adapter,
      },
      workspace: {
        getLeavesOfType: vi.fn((type: string) => (type === VIEW_TYPE_CODEX_PANEL ? leaves : [])),
        revealLeaf: vi.fn().mockResolvedValue(undefined),
        getRightLeaf: vi.fn(() => null),
        getMostRecentLeaf: vi.fn(() => null),
        getActiveViewOfType: vi.fn(() => null),
        ensureSideLeaf: vi.fn(() => Promise.reject(new Error("Unexpected ensureSideLeaf call."))),
        activeLeaf: null,
        rightSplit: {},
      },
    } as never,
    {} as never,
  );
}

type TestLeaf = ReturnType<typeof leaf>;

function leaf(options: { state?: Record<string, unknown> } = {}) {
  return {
    view: null as unknown,
    getViewState: vi.fn(() => ({ type: VIEW_TYPE_CODEX_PANEL, state: options.state ?? {} })),
    getRoot: vi.fn(() => ({})),
    parent: {},
    setViewState: vi.fn().mockResolvedValue(undefined),
    loadIfDeferred: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(),
  };
}

function chatView(CodexChatViewCtor: typeof CodexChatView, leaf: TestLeaf) {
  const containerEl = document.createElement("div");
  containerEl.createDiv();
  containerEl.createDiv();
  return new CodexChatViewCtor(
    {
      ...leaf,
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          getLastOpenFiles: vi.fn(() => []),
          on: vi.fn(() => ({})),
          openLinkText: vi.fn(),
          requestSaveLayout: vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
          getFiles: vi.fn(() => []),
          getMarkdownFiles: vi.fn(() => []),
        },
      },
      containerEl,
    } as never,
    {
      settings: { ...DEFAULT_SETTINGS, codexPath: "codex", sendShortcut: "enter" },
      vaultPath: "/vault",
      openThreadInNewView: vi.fn(),
      openThreadInAvailableView: vi.fn(),
      focusThreadInOpenView: vi.fn(),
      openTurnDiff: vi.fn(),
      notifyThreadArchived: vi.fn(),
      notifyThreadRenamed: vi.fn(),
      refreshSharedThreadListFromOpenSurface: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
      applyThreadListSnapshot: vi.fn(),
      refreshThreadList: vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>),
      cachedThreadList: vi.fn(() => null),
      publishAppServerMetadata: vi.fn(),
      cachedAppServerMetadata: vi.fn(() => null),
    },
  );
}

function thread(id: string): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    preview: id,
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
  } as Thread;
}

function panelSnapshot(
  overrides: Partial<ReturnType<CodexChatView["openPanelSnapshot"]>> = {},
): ReturnType<CodexChatView["openPanelSnapshot"]> {
  return {
    viewId: "view",
    threadId: "thread",
    turnLifecycle: { kind: "idle" },
    pendingApprovals: 0,
    pendingUserInputs: 0,
    hasComposerDraft: false,
    connected: true,
    ...overrides,
  };
}
