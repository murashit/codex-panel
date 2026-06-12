// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type CodexPanelPlugin from "../src/main";
import type { CodexChatView } from "../src/features/chat/view";
import type { CodexChatHost } from "../src/features/chat/chat-host";
import type { Thread } from "../src/domain/threads/model";
import type { SharedAppServerCache } from "../src/app-server/services/shared-cache";
import type { SharedAppServerCacheContext } from "../src/app-server/services/shared-cache-state";
import type { WorkspacePanelCoordinator } from "../src/workspace/panel-coordinator";
import type { ThreadSurfaceCoordinator } from "../src/workspace/thread-surface-coordinator";
import { installObsidianDomShims } from "./support/dom";

installObsidianDomShims();

function panels(plugin: CodexPanelPlugin): WorkspacePanelCoordinator {
  return (plugin as unknown as { panels: WorkspacePanelCoordinator }).panels;
}

function threadSurfaces(plugin: CodexPanelPlugin): ThreadSurfaceCoordinator {
  return (plugin as unknown as { threadSurfaces: ThreadSurfaceCoordinator }).threadSurfaces;
}

function sharedAppServerCache(plugin: CodexPanelPlugin): SharedAppServerCache {
  return (plugin as unknown as { sharedAppServerCache: SharedAppServerCache }).sharedAppServerCache;
}

function chatHost(plugin: CodexPanelPlugin): CodexChatHost {
  return (plugin as unknown as { chatHost(): CodexChatHost }).chatHost();
}

function sharedAppServerCacheContext(
  plugin: CodexPanelPlugin,
  overrides: Partial<SharedAppServerCacheContext> = {},
): SharedAppServerCacheContext {
  return {
    codexPath: plugin.settings.codexPath,
    vaultPath: plugin.vaultPath,
    appServerUserAgent: null,
    ...overrides,
  };
}

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

    await panels(plugin).openThreadInAvailableView("thread-1");

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
      lastFocused: false,
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

    await panels(plugin).openThreadInAvailableView("thread-1");

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
      lastFocused: false,
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
      lastFocused: false,
      turnLifecycle: { kind: "idle" },
      pendingApprovals: 0,
      pendingUserInputs: 0,
      hasComposerDraft: false,
      connected: true,
    });
    const openEmptyThread = vi.spyOn(emptyView, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([busyLeaf, emptyLeaf]);

    await panels(plugin).openThreadInAvailableView("thread-1");

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

    await panels(plugin).openThreadInCurrentView("thread-1");

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

    await panels(plugin).openThreadInCurrentView("thread-1");

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

    await panels(plugin).openThreadInCurrentView("thread-1");

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

    await panels(plugin).openThreadInCurrentView("selected-thread");

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

    await panels(plugin).openThreadInNewView("thread-1");

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

    await expect(panels(plugin).activateView()).resolves.toBe(activeView);

    expect((plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([activeLeaf]);
    expect(connectActive).toHaveBeenCalledOnce();
    expect(focusActive).toHaveBeenCalledOnce();
    expect(connectFirst).not.toHaveBeenCalled();
    expect(focusFirst).not.toHaveBeenCalled();
    expect((plugin.app.workspace.ensureSideLeaf as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("marks snapshots for the last focused Codex panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn(firstLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    vi.spyOn(secondLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "second", threadId: "thread-2" }),
    );
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const activeLeafHandlers: ((leaf: TestLeaf | null) => void)[] = [];
    (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation((name: string, handler: (leaf: TestLeaf | null) => void) => {
      if (name === "active-leaf-change") activeLeafHandlers.push(handler);
      return {};
    });
    const refreshLiveState = vi.spyOn(threadSurfaces(plugin), "refreshThreadsViewLiveState").mockImplementation(() => undefined);

    await plugin.onload();
    const activeLeafHandler = activeLeafHandlers.at(0);
    if (!activeLeafHandler) throw new Error("Expected active leaf handler to be registered.");
    activeLeafHandler(secondLeaf);

    expect(refreshLiveState).toHaveBeenCalledOnce();
    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      { viewId: "first", lastFocused: false },
      { viewId: "second", lastFocused: true },
    ]);
  });

  it("initially marks the active Codex panel before focus events arrive", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn(firstLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    vi.spyOn(activeView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "active", threadId: "thread-2" }));
    const plugin = await pluginWithLeaves([firstLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);

    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      { viewId: "first", lastFocused: false },
      { viewId: "active", lastFocused: true },
    ]);
  });

  it("initially falls back to the most recent right sidebar Codex panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const recentLeaf = leaf();
    recentLeaf.view = chatView(CodexChatView, recentLeaf);
    vi.spyOn(recentLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "recent", threadId: "thread-1" }),
    );
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn(otherLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "other", threadId: "thread-2" }),
    );
    const plugin = await pluginWithLeaves([recentLeaf, otherLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(recentLeaf);

    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      { viewId: "recent", lastFocused: true },
      { viewId: "other", lastFocused: false },
    ]);
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

    await panels(plugin).openNewPanel();

    expect(connect).toHaveBeenCalledOnce();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(openThread).not.toHaveBeenCalled();
  });

  it("refreshes shared thread lists after archive lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi
      .spyOn(threadSurfaces(plugin), "refreshSharedThreadListFromOpenSurface")
      .mockImplementation(() => undefined);

    threadSurfaces(plugin).notifyThreadArchived("thread-1");

    expect(refreshSharedThreadList).toHaveBeenCalledOnce();
  });

  it("closes matching chat panels only when archive notification requests it", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn(matchingLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn(otherLeaf.view as CodexChatView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, matchingLeaf, otherLeaf]);
    vi.spyOn(threadSurfaces(plugin), "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    threadSurfaces(plugin).notifyThreadArchived("thread-1");

    expect(restoredMatchingLeaf.detach).not.toHaveBeenCalled();
    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();

    threadSurfaces(plugin).notifyThreadArchived("thread-1", { closeOpenPanels: true });

    expect(restoredMatchingLeaf.detach).toHaveBeenCalledOnce();
    expect(matchingLeaf.detach).toHaveBeenCalledOnce();
    expect(otherLeaf.detach).not.toHaveBeenCalled();
  });

  it("refreshes shared thread lists after rename lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi
      .spyOn(threadSurfaces(plugin), "refreshSharedThreadListFromOpenSurface")
      .mockImplementation(() => undefined);

    threadSurfaces(plugin).notifyThreadRenamed("thread-1", "Renamed thread");

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

    const context = sharedAppServerCacheContext(plugin, { appServerUserAgent: "codex-cli/1.2.3" });
    const first = sharedAppServerCache(plugin).refreshThreadList(context, fetchThreads);
    const second = sharedAppServerCache(plugin).refreshThreadList(context, secondFetch);

    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(secondFetch).not.toHaveBeenCalled();
    resolveThreads([thread("first")]);

    await expect(first).resolves.toEqual([thread("first")]);
    await expect(second).resolves.toEqual([thread("first")]);
    expect(sharedAppServerCache(plugin).cachedThreadList(context)).toEqual([thread("first")]);
  });

  it("keeps shared thread list refreshes separate across app-server cache contexts", async () => {
    const plugin = await pluginWithLeaves([]);
    const firstContext = sharedAppServerCacheContext(plugin, { codexPath: "codex-a", appServerUserAgent: "codex-cli/1.2.3" });
    const secondContext = sharedAppServerCacheContext(plugin, { codexPath: "codex-b", appServerUserAgent: "codex-cli/1.2.3" });
    let resolveFirst!: (threads: Thread[]) => void;
    const firstFetch = vi.fn(
      () =>
        new Promise<Thread[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondFetch = vi.fn().mockResolvedValue([thread("second")]);

    const first = sharedAppServerCache(plugin).refreshThreadList(firstContext, firstFetch);
    const second = sharedAppServerCache(plugin).refreshThreadList(secondContext, secondFetch);

    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).toHaveBeenCalledOnce();
    await expect(second).resolves.toEqual([thread("second")]);
    expect(sharedAppServerCache(plugin).cachedThreadList(secondContext)).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await expect(first).resolves.toEqual([thread("first")]);
    expect(sharedAppServerCache(plugin).cachedThreadList(secondContext)).toEqual([thread("second")]);
    expect(sharedAppServerCache(plugin).cachedThreadList(firstContext)).toBeNull();
  });

  it("keys shared thread list snapshots by published app-server identity", async () => {
    const plugin = await pluginWithLeaves([]);
    const host = chatHost(plugin);

    host.publishAppServerIdentity("codex-cli/1.2.3");
    await host.refreshThreadList(() => Promise.resolve([thread("versioned")]));

    expect(
      sharedAppServerCache(plugin).cachedThreadList(sharedAppServerCacheContext(plugin, { appServerUserAgent: "codex-cli/1.2.3" })),
    ).toEqual([thread("versioned")]);

    host.publishAppServerIdentity("codex-cli/9.9.9");

    expect(host.cachedThreadList()).toBeNull();
  });

  it("keeps the previous shared thread list when refresh fails", async () => {
    const plugin = await pluginWithLeaves([]);
    const context = sharedAppServerCacheContext(plugin, { appServerUserAgent: "codex-cli/1.2.3" });
    await sharedAppServerCache(plugin).refreshThreadList(context, () => Promise.resolve([thread("cached")]));

    await expect(sharedAppServerCache(plugin).refreshThreadList(context, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    expect(sharedAppServerCache(plugin).cachedThreadList(context)).toEqual([thread("cached")]);
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

    threadSurfaces(plugin).refreshSharedThreadListFromOpenSurface();

    expect(disconnectedRefresh).not.toHaveBeenCalled();
    expect(connectedRefresh).toHaveBeenCalledOnce();
  });

  it("refreshes shared thread lists from a remaining connected panel after the archived panel is detached", async () => {
    const { CodexChatView } = await import("../src/features/chat/view");
    const sourceLeaf = leaf();
    sourceLeaf.view = chatView(CodexChatView, sourceLeaf);
    const sourceView = sourceLeaf.view as CodexChatView;
    vi.spyOn(sourceView, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "source", threadId: "thread-1", connected: true }));
    const sourceRefresh = vi.spyOn(sourceView, "refreshSharedThreadList").mockResolvedValue(undefined);

    const remainingLeaf = leaf();
    remainingLeaf.view = chatView(CodexChatView, remainingLeaf);
    const remainingView = remainingLeaf.view as CodexChatView;
    vi.spyOn(remainingView, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "remaining", threadId: "forked-thread", connected: true }),
    );
    const remainingRefresh = vi.spyOn(remainingView, "refreshSharedThreadList").mockResolvedValue(undefined);

    const leaves = [sourceLeaf, remainingLeaf];
    sourceLeaf.detach.mockImplementation(() => {
      leaves.splice(leaves.indexOf(sourceLeaf), 1);
    });
    const plugin = await pluginWithLeaves(leaves);

    sourceLeaf.detach();
    threadSurfaces(plugin).notifyThreadArchived("thread-1");

    expect(sourceRefresh).not.toHaveBeenCalled();
    expect(remainingRefresh).toHaveBeenCalledOnce();
  });
});

async function pluginWithLeaves(leaves: ReturnType<typeof leaf>[]) {
  const { default: CodexPanelPlugin } = await import("../src/main");
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  const plugin = new CodexPanelPlugin(
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
        on: vi.fn(() => ({})),
        activeLeaf: null,
        rightSplit: {},
      },
    } as never,
    {} as never,
  );
  plugin.vaultPath = "/vault";
  return plugin;
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
      publishAppServerIdentity: vi.fn(),
      cachedAppServerMetadata: vi.fn(() => null),
    },
  );
}

function thread(id: string): Thread {
  return {
    id,
    preview: id,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}

function panelSnapshot(
  overrides: Partial<ReturnType<CodexChatView["openPanelSnapshot"]>> = {},
): ReturnType<CodexChatView["openPanelSnapshot"]> {
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
