// @vitest-environment jsdom

import { FileSystemAdapter } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS } from "../src/constants";
import type { Thread } from "../src/domain/threads/model";
import type { CodexChatHost } from "../src/features/chat/host/contracts";
import type { CodexChatView } from "../src/features/chat/host/view.obsidian";
import type CodexPanelPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import { WorkspacePanelCoordinator } from "../src/workspace/panel-coordinator";
import { waitForAsyncWork } from "./support/async";
import { installObsidianDomShims } from "./support/dom";

installObsidianDomShims();

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

function panels(plugin: CodexPanelPlugin) {
  return new WorkspacePanelCoordinator({
    app: plugin.app,
    refreshThreadsViewLiveState: vi.fn(),
  });
}

function threadCatalog(plugin: CodexPanelPlugin) {
  return plugin.runtime.chatHost().threadCatalog;
}

describe("CodexPanelPlugin workspace panel reconciliation", () => {
  beforeEach(() => {
    vi.useRealTimers();
    withShortLivedAppServerClientMock.mockReset();
  });

  it("loads restored Codex panel leaves after startup without blocking onload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    await plugin.onload();

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
  });

  it("cancels pending workspace panel reconciliation on unload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf]);

    await plugin.onload();
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(0);

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("clears pending workspace panel reconciliation timers on reset without cancelling future schedules", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const coordinator = panels(await pluginWithLeaves([firstLeaf]));

    coordinator.scheduleWorkspacePanelReconcile();
    coordinator.reset();
    await vi.advanceTimersByTimeAsync(0);

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();

    coordinator.scheduleWorkspacePanelReconcile();
    await vi.advanceTimersByTimeAsync(0);

    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("loads and focuses a deferred restored panel before opening another panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = chatView(CodexChatView, restoredLeaf);
    });

    await panels(plugin).openThreadInAvailableView("thread-1");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(restoredLeaf.view).toBeInstanceOf(CodexChatView);
  });

  it("includes deferred restored panels in open panel snapshots", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);

    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      {
        threadId: "thread-1",
        turnLifecycle: { kind: "idle" },
        pendingRequests: { actionable: 0 },
        hasComposerDraft: false,
        connected: false,
        lastFocused: false,
      },
    ]);
  });

  it("focuses an already open thread before reusing an empty panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const openLeaf = leaf();
    openLeaf.view = chatView(CodexChatView, openLeaf);
    const openView = openLeaf.view as CodexChatView;
    vi.spyOn(openView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "open-view", threadId: "thread-1" }));
    vi.spyOn(openView.surface, "focusThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const emptyView = emptyLeaf.view as CodexChatView;
    const openEmptyThread = vi.spyOn(emptyView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([openLeaf, emptyLeaf]);

    await panels(plugin).openThreadInAvailableView("thread-1");

    expect((plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([openLeaf]);
    expect(openEmptyThread).not.toHaveBeenCalled();
  });

  it("reuses an idle empty panel before opening a new panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const busyLeaf = leaf();
    busyLeaf.view = chatView(CodexChatView, busyLeaf);
    const busyView = busyLeaf.view as CodexChatView;
    vi.spyOn(busyView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "busy-view", threadId: "other-thread" }));
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const emptyView = emptyLeaf.view as CodexChatView;
    vi.spyOn(emptyView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "empty-view", threadId: null }));
    const openEmptyThread = vi.spyOn(emptyView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([busyLeaf, emptyLeaf]);

    await panels(plugin).openThreadInAvailableView("thread-1");

    expect(openEmptyThread).toHaveBeenCalledWith("thread-1");
  });

  it("does not reuse an idle panel with a pending MCP elicitation as empty", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const pendingLeaf = leaf();
    pendingLeaf.view = chatView(CodexChatView, pendingLeaf);
    const pendingView = pendingLeaf.view as CodexChatView;
    vi.spyOn(pendingView.surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "pending-view", threadId: null, pendingMcpElicitations: 1 }),
    );
    const openPendingThread = vi.spyOn(pendingView.surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const emptyView = emptyLeaf.view as CodexChatView;
    vi.spyOn(emptyView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "empty-view", threadId: null }));
    const openEmptyThread = vi.spyOn(emptyView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([pendingLeaf, emptyLeaf]);

    await panels(plugin).openThreadInAvailableView("thread-1");

    expect(openPendingThread).not.toHaveBeenCalled();
    expect(openEmptyThread).toHaveBeenCalledWith("thread-1");
  });

  it("opens picker Enter selections in the most recent panel when the thread is not already open", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const olderLeaf = leaf();
    olderLeaf.view = chatView(CodexChatView, olderLeaf);
    const olderView = olderLeaf.view as CodexChatView;
    const openOlderThread = vi.spyOn(olderView.surface, "openThread").mockResolvedValue(undefined);
    const currentLeaf = leaf();
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const currentView = currentLeaf.view as CodexChatView;
    const openCurrentThread = vi.spyOn(currentView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([olderLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(openCurrentThread).toHaveBeenCalledWith("thread-1");
    expect(openOlderThread).not.toHaveBeenCalled();
  });

  it("opens picker Enter selections in the active Codex panel before the right-sidebar fallback", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const fallbackLeaf = leaf();
    fallbackLeaf.view = chatView(CodexChatView, fallbackLeaf);
    const fallbackView = fallbackLeaf.view as CodexChatView;
    const openFallbackThread = vi.spyOn(fallbackView.surface, "openThread").mockResolvedValue(undefined);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    const openActiveThread = vi.spyOn(activeView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([fallbackLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(fallbackLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(openActiveThread).toHaveBeenCalledWith("thread-1");
    expect(openFallbackThread).not.toHaveBeenCalled();
  });

  it("focuses an already open thread before picker Enter overwrites the current panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const openLeaf = leaf();
    openLeaf.view = chatView(CodexChatView, openLeaf);
    const openView = openLeaf.view as CodexChatView;
    vi.spyOn(openView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "open-view", threadId: "thread-1" }));
    const focusOpenThread = vi.spyOn(openView.surface, "focusThread").mockResolvedValue(undefined);
    const currentLeaf = leaf();
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const currentView = currentLeaf.view as CodexChatView;
    const openCurrentThread = vi.spyOn(currentView.surface, "openThread").mockResolvedValue(undefined);
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    const openThread = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    const focusThread = vi.spyOn(view.surface, "focusThread").mockResolvedValue(undefined);
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
    });
    const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
    const focusComposer = vi.spyOn(view.surface, "focusComposer").mockImplementation(() => undefined);
    const openThread = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);

    await panels(plugin).openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(openThread).toHaveBeenCalledWith("thread-1");
  });

  it("activates the active Codex panel instead of the first existing panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstView = firstLeaf.view as CodexChatView;
    const connectFirst = vi.spyOn(firstView.surface, "connect").mockResolvedValue(undefined);
    const focusFirst = vi.spyOn(firstView.surface, "focusThread").mockResolvedValue(undefined);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    const connectActive = vi.spyOn(activeView.surface, "connect").mockResolvedValue(undefined);
    const focusActive = vi.spyOn(activeView.surface, "focusThread").mockResolvedValue(undefined);
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const { CodexThreadsView } = await import("../src/features/threads-view/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn((firstLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    vi.spyOn((secondLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "second", threadId: "thread-2" }),
    );
    const activeLeafHandlers: ((leaf: TestLeaf | null) => void)[] = [];
    const refreshThreadsViewLiveState = vi.fn();
    const threadsView = Object.assign(Object.create(CodexThreadsView.prototype), {
      refreshLiveState: refreshThreadsViewLiveState,
    }) as InstanceType<typeof CodexThreadsView>;
    const threadsLeaf = leaf();
    threadsLeaf.view = threadsView;
    const pluginWithThreads = await pluginWithLeaves([firstLeaf, secondLeaf], { threadsLeaves: [threadsLeaf] });
    (pluginWithThreads.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string, handler: (leaf: TestLeaf | null) => void) => {
        if (name === "active-leaf-change") activeLeafHandlers.push(handler);
        return {};
      },
    );

    await pluginWithThreads.onload();
    const activeLeafHandler = activeLeafHandlers.at(0);
    if (!activeLeafHandler) throw new Error("Expected active leaf handler to be registered.");
    activeLeafHandler(secondLeaf);

    expect(refreshThreadsViewLiveState).toHaveBeenCalledOnce();
    expect(pluginWithThreads.runtime.threadsHost().openPanelActivities()).toMatchObject([
      { threadId: "thread-1", selected: false },
      { threadId: "thread-2", selected: true },
    ]);
  });

  it("hydrates restored panels when Obsidian activates an open Codex tab", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const hydrateRestoredThread = vi.spyOn((panelLeaf.view as CodexChatView).surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    const activeLeafHandlers: ((leaf: TestLeaf | null) => void)[] = [];
    const plugin = await pluginWithLeaves([panelLeaf]);
    (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation((name: string, handler: (leaf: TestLeaf | null) => void) => {
      if (name === "active-leaf-change") activeLeafHandlers.push(handler);
      return {};
    });

    await plugin.onload();
    const activeLeafHandler = activeLeafHandlers.at(0);
    if (!activeLeafHandler) throw new Error("Expected active leaf handler to be registered.");
    activeLeafHandler(panelLeaf);

    await waitForAsyncWork(() => {
      expect(hydrateRestoredThread).toHaveBeenCalledOnce();
    });
  });

  it("loads and hydrates the startup foreground Codex panel through workspace reconciliation", async () => {
    vi.useFakeTimers();
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const activeLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const view = chatView(CodexChatView, activeLeaf);
    const hydrateRestoredThread = vi.spyOn(view.surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    activeLeaf.loadIfDeferred.mockImplementation(async () => {
      activeLeaf.view = view;
    });
    const plugin = await pluginWithLeaves([activeLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(activeLeaf);

    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    await waitForAsyncWork(() => {
      expect(activeLeaf.loadIfDeferred).toHaveBeenCalledOnce();
      expect(hydrateRestoredThread).toHaveBeenCalledOnce();
    });
  });

  it("hydrates the right sidebar Codex panel on startup when the active leaf is a note", async () => {
    vi.useFakeTimers();
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const noteLeaf = nonPanelLeaf();
    const view = chatView(CodexChatView, restoredLeaf);
    const hydrateRestoredThread = vi.spyOn(view.surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = view;
    });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockImplementation((root?: unknown) =>
      root === plugin.app.workspace.rightSplit ? restoredLeaf : noteLeaf,
    );

    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    await waitForAsyncWork(() => {
      expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
      expect(hydrateRestoredThread).toHaveBeenCalledOnce();
    });
  });

  it("initially marks the active Codex panel before focus events arrive", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn((firstLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    vi.spyOn(activeView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "active", threadId: "thread-2" }));
    const plugin = await pluginWithLeaves([firstLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);

    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      { viewId: "first", lastFocused: false },
      { viewId: "active", lastFocused: true },
    ]);
  });

  it("initially falls back to the most recent right sidebar Codex panel", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const recentLeaf = leaf();
    recentLeaf.view = chatView(CodexChatView, recentLeaf);
    vi.spyOn((recentLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "recent", threadId: "thread-1" }),
    );
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
    });
    const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
    const focusComposer = vi.spyOn(view.surface, "focusComposer").mockImplementation(() => undefined);
    const openThread = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);

    await panels(plugin).openNewPanel();

    expect(connect).toHaveBeenCalledOnce();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(openThread).not.toHaveBeenCalled();
  });

  it("does not refresh shared thread lists after known archive mutations", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    const refreshSharedThreads = vi.spyOn(connectedView.surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([connectedLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(refreshSharedThreads).not.toHaveBeenCalled();
  });

  it("applies known archive mutations to open chat surfaces", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstArchived = vi.spyOn((firstLeaf.view as CodexChatView).surface, "applyThreadArchived").mockImplementation(() => undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondArchived = vi.spyOn((secondLeaf.view as CodexChatView).surface, "applyThreadArchived").mockImplementation(() => undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(firstArchived).toHaveBeenCalledWith("thread-1");
    expect(secondArchived).toHaveBeenCalledWith("thread-1");
  });

  it("closes matching chat panels only when archive notification requests it", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, matchingLeaf, otherLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(restoredMatchingLeaf.detach).not.toHaveBeenCalled();
    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1", options: { closeOpenPanels: true } });

    expect(restoredMatchingLeaf.detach).toHaveBeenCalledOnce();
    expect(matchingLeaf.detach).toHaveBeenCalledOnce();
    expect(otherLeaf.detach).not.toHaveBeenCalled();
  });

  it("does not refresh shared thread lists after known rename mutations", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    const refreshSharedThreads = vi.spyOn(connectedView.surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([connectedLeaf]);

    threadCatalog(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

    expect(refreshSharedThreads).not.toHaveBeenCalled();
  });

  it("applies known rename mutations to open chat surfaces", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstRenamed = vi.spyOn((firstLeaf.view as CodexChatView).surface, "applyThreadRenamed").mockImplementation(() => undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondRenamed = vi.spyOn((secondLeaf.view as CodexChatView).surface, "applyThreadRenamed").mockImplementation(() => undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    threadCatalog(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

    expect(firstRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
    expect(secondRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
  });

  it("single-flights shared thread list refreshes and caches successful results", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(true);
    let resolveThreads!: (threads: Thread[]) => void;
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient").mockImplementation((operation) =>
      operation(
        threadListClient(
          () =>
            new Promise<Thread[]>((resolve) => {
              resolveThreads = resolve;
            }),
        ),
      ),
    );
    const plugin = await pluginWithLeaves([connectedLeaf]);
    plugin.settings.codexPath = "codex";

    const first = threadCatalog(plugin).refreshActive();
    const second = threadCatalog(plugin).refreshActive();
    await flushMicrotasks();

    expect(runWithAppServerClient).toHaveBeenCalledOnce();
    resolveThreads([thread("first")]);

    await expect(first).resolves.toEqual([thread("first")]);
    await expect(second).resolves.toEqual([thread("first")]);
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("first")]);
  });

  it("keeps shared thread list refreshes separate across app-server cache contexts", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(true);
    let resolveFirst!: (threads: Thread[]) => void;
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient");
    const plugin = await pluginWithLeaves([connectedLeaf]);
    plugin.settings.codexPath = "codex-a";
    runWithAppServerClient.mockImplementation((operation) =>
      operation(
        threadListClient(() =>
          plugin.settings.codexPath === "codex-a"
            ? new Promise<Thread[]>((resolve) => {
                resolveFirst = resolve;
              })
            : Promise.resolve([thread("second")]),
        ),
      ),
    );

    const first = threadCatalog(plugin).refreshActive();
    await flushMicrotasks();
    plugin.settings.codexPath = "codex-b";
    const second = threadCatalog(plugin).refreshActive();
    await flushMicrotasks();

    expect(runWithAppServerClient).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual([thread("second")]);
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await expect(first).rejects.toThrow("Codex app-server query context changed while loading shared queries.");
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);
    plugin.settings.codexPath = "codex-a";
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("first")]);
  });

  it("does not reuse a connected panel whose app-server context does not match the shared query", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(false);
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient").mockResolvedValue([thread("wrong-context")]);
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(threadListClient(() => Promise.resolve([thread("matching-context")]))),
    );
    const plugin = await pluginWithLeaves([connectedLeaf]);
    plugin.settings.codexPath = "codex-b";

    await expect(threadCatalog(plugin).refreshActive()).resolves.toEqual([thread("matching-context")]);

    expect(runWithAppServerClient).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith("codex-b", "/vault", expect.any(Function), {});
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("matching-context")]);
  });

  it("keeps the previous shared thread list when refresh fails", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(true);
    const runWithAppServerClient = vi
      .spyOn(connectedView.surface, "runWithAppServerClient")
      .mockImplementationOnce((operation) => operation(threadListClient(() => Promise.resolve([thread("cached")]))))
      .mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const plugin = await pluginWithLeaves([connectedLeaf]);
    await threadCatalog(plugin).refreshActive();

    await expect(threadCatalog(plugin).refreshActive()).rejects.toThrow("boom");

    expect(runWithAppServerClient).toHaveBeenCalledTimes(2);
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("cached")]);
  });

  it("uses a short-lived client when the operation declares an unhandled server-request policy", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient").mockResolvedValue("chat-result");
    const shortLivedClient = { readEffectiveConfig: vi.fn().mockResolvedValue({}) };
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: typeof shortLivedClient) => Promise<unknown>) =>
        operation(shortLivedClient),
    );
    const plugin = await pluginWithLeaves([connectedLeaf]);
    plugin.settings.codexPath = "codex";

    const result = await plugin.runtime.withClient((client) => client.readEffectiveConfig("/vault") as Promise<unknown>, {
      serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
    });

    expect(result).toEqual({});
    expect(runWithAppServerClient).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith("codex", "/vault", expect.any(Function), {
      serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
    });
    expect(shortLivedClient.readEffectiveConfig).toHaveBeenCalledWith("/vault");
  });

  it("refreshes shared thread lists from a remaining connected panel after the archived panel is detached", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const sourceLeaf = leaf();
    sourceLeaf.view = chatView(CodexChatView, sourceLeaf);
    const sourceView = sourceLeaf.view as CodexChatView;
    vi.spyOn(sourceView.surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "source", threadId: "thread-1", connected: true }),
    );
    const sourceRefresh = vi.spyOn(sourceView.surface, "refreshSharedThreads").mockResolvedValue(undefined);

    const remainingLeaf = leaf();
    remainingLeaf.view = chatView(CodexChatView, remainingLeaf);
    const remainingView = remainingLeaf.view as CodexChatView;
    vi.spyOn(remainingView.surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "remaining", threadId: "forked-thread", connected: true }),
    );
    const remainingRefresh = vi.spyOn(remainingView.surface, "refreshSharedThreads").mockResolvedValue(undefined);

    const leaves = [sourceLeaf, remainingLeaf];
    sourceLeaf.detach.mockImplementation(() => {
      leaves.splice(leaves.indexOf(sourceLeaf), 1);
    });
    const plugin = await pluginWithLeaves(leaves);

    sourceLeaf.detach();
    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(sourceRefresh).not.toHaveBeenCalled();
    expect(remainingRefresh).not.toHaveBeenCalled();
  });
});

async function pluginWithLeaves(leaves: ReturnType<typeof leaf>[], options: { threadsLeaves?: ReturnType<typeof leaf>[] } = {}) {
  const { default: CodexPanelPlugin } = await import("../src/main");
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  const plugin = new CodexPanelPlugin(
    {
      vault: {
        adapter,
      },
      workspace: {
        getLeavesOfType: vi.fn((type: string) => {
          if (type === VIEW_TYPE_CODEX_PANEL) return leaves;
          if (type === VIEW_TYPE_CODEX_THREADS) return options.threadsLeaves ?? [];
          return [];
        }),
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

function nonPanelLeaf() {
  return {
    view: null as unknown,
    getViewState: vi.fn(() => ({ type: "markdown", state: {} })),
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
          offref: vi.fn(),
          getFiles: vi.fn(() => []),
          getMarkdownFiles: vi.fn(() => []),
          getAbstractFileByPath: vi.fn(() => null),
        },
        metadataCache: {
          on: vi.fn(() => ({})),
          offref: vi.fn(),
          getFirstLinkpathDest: vi.fn(() => null),
          fileToLinktext: vi.fn((_file: unknown, _sourcePath: string) => ""),
          getFileCache: vi.fn(() => null),
        },
      },
      containerEl,
    } as never,
    chatHostFixture(),
  );
}

function chatHostFixture(): CodexChatHost {
  return {
    settingsRef: {
      settings: { ...DEFAULT_SETTINGS, codexPath: "codex", sendShortcut: "enter" },
      vaultPath: "/vault",
    },
    workspace: {
      openThreadInNewView: vi.fn(),
      focusThreadInOpenView: vi.fn(),
      openTurnDiff: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
    },
    appServerQueries: {
      updateAppServerMetadata: vi.fn(() => null),
      appServerMetadataSnapshot: vi.fn(() => null),
      refreshAppServerMetadata: vi.fn(() => Promise.resolve(null)),
      modelsSnapshot: vi.fn(() => null),
      fetchModels: vi.fn(() => Promise.resolve([])),
      refreshModels: vi.fn(() => Promise.resolve([])),
      observeAppServerMetadataResult: vi.fn(() => () => undefined),
      observeModelsResult: vi.fn(() => () => undefined),
    },
    threadCatalog: {
      apply: vi.fn(),
      loadActive: vi.fn(() => Promise.resolve([])),
      refreshActive: vi.fn(() => Promise.resolve([])),
      activeSnapshot: vi.fn(() => null),
      observeActive: vi.fn(() => () => undefined),
    },
  };
}

function threadListClient(fetchThreads: () => Promise<readonly Thread[]>): never {
  return {
    listThreads: async () => ({
      data: await fetchThreads(),
      nextCursor: null,
    }),
  } as never;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
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

function panelSnapshot(overrides: PanelSnapshotFixtureOverrides = {}): ReturnType<CodexChatView["surface"]["openPanelSnapshot"]> {
  const { pendingApprovals, pendingUserInputs, pendingMcpElicitations, ...snapshotOverrides } = overrides;
  const pendingRequests = snapshotOverrides.pendingRequests ?? {
    approvals: pendingApprovals ?? 0,
    userInputs: pendingUserInputs ?? 0,
    mcpElicitations: pendingMcpElicitations ?? 0,
    actionable: (pendingApprovals ?? 0) + (pendingUserInputs ?? 0) + (pendingMcpElicitations ?? 0),
  };
  return {
    viewId: "view",
    threadId: "thread",
    turnLifecycle: { kind: "idle" },
    pendingRequests,
    hasComposerDraft: false,
    connected: true,
    ...snapshotOverrides,
  };
}

type PanelSnapshotFixtureOverrides = Partial<ReturnType<CodexChatView["surface"]["openPanelSnapshot"]>> & {
  pendingApprovals?: number;
  pendingUserInputs?: number;
  pendingMcpElicitations?: number;
};
