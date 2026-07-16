// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL } from "../../src/constants";
import type { CodexChatView } from "../../src/features/chat/host/view.obsidian";
import type CodexPanelPlugin from "../../src/main";
import { WorkspacePanelCoordinator } from "../../src/workspace/panel-coordinator";
import { installObsidianDomShims } from "../support/dom";
import { chatView, leaf, panelSnapshot, pluginWithLeaves } from "../support/plugin-fixtures";

installObsidianDomShims();

describe("WorkspacePanelCoordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("cancels a pending reconciliation without cancelling later schedules", async () => {
    vi.useFakeTimers();
    const panelLeaf = leaf();
    const coordinator = panels(await pluginWithLeaves([panelLeaf]));

    coordinator.scheduleWorkspacePanelReconcile();
    coordinator.reset();
    await vi.advanceTimersByTimeAsync(0);
    expect(panelLeaf.loadIfDeferred).not.toHaveBeenCalled();

    coordinator.scheduleWorkspacePanelReconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(panelLeaf.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("includes deferred restored panels in snapshots", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const coordinator = panels(await pluginWithLeaves([restoredLeaf]));

    expect(coordinator.getOpenPanelSnapshots()).toMatchObject([
      { threadId: "thread-1", connected: false, lastFocused: false, pendingRequests: { actionable: 0 } },
    ]);
  });

  it("focuses an already open thread before reusing an empty panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const openLeaf = leaf();
    openLeaf.view = chatView(CodexChatView, openLeaf);
    vi.spyOn((openLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "open", threadId: "thread-1" }),
    );
    const focus = vi.spyOn((openLeaf.view as CodexChatView).surface, "focusThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const open = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([openLeaf, emptyLeaf]);

    await panels(plugin).openThreadInAvailableView("thread-1");

    expect(focus).toHaveBeenCalledWith("thread-1");
    expect(open).not.toHaveBeenCalled();
  });

  it("reuses an idle empty panel but skips one with an actionable request", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const pendingLeaf = leaf();
    pendingLeaf.view = chatView(CodexChatView, pendingLeaf);
    vi.spyOn((pendingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "pending", threadId: null, pendingMcpElicitations: 1 }),
    );
    const openPending = vi.spyOn((pendingLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "empty", threadId: null }),
    );
    const openEmpty = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([pendingLeaf, emptyLeaf])).openThreadInAvailableView("thread-1");

    expect(openPending).not.toHaveBeenCalled();
    expect(openEmpty).toHaveBeenCalledWith("thread-1");
  });

  it("uses the active Codex panel for current-view selections", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const fallbackLeaf = leaf();
    fallbackLeaf.view = chatView(CodexChatView, fallbackLeaf);
    const fallbackOpen = vi.spyOn((fallbackLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    const activeOpen = vi.spyOn(activeView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([fallbackLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(fallbackLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(activeOpen).toHaveBeenCalledWith("thread-1");
    expect(fallbackOpen).not.toHaveBeenCalled();
  });

  it("preserves an already open destination before replacing the current panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const destinationLeaf = leaf();
    destinationLeaf.view = chatView(CodexChatView, destinationLeaf);
    vi.spyOn((destinationLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "destination", threadId: "thread-1" }),
    );
    const focusDestination = vi.spyOn((destinationLeaf.view as CodexChatView).surface, "focusThread").mockResolvedValue(undefined);
    const currentLeaf = leaf();
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const openCurrent = vi.spyOn((currentLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([destinationLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(focusDestination).toHaveBeenCalledWith("thread-1");
    expect(openCurrent).not.toHaveBeenCalled();
  });

  it("restores an exact deferred destination before replacing the current panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1" } });
    const currentLeaf = leaf();
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const openCurrent = vi.spyOn((currentLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const restoredView = chatView(CodexChatView, restoredLeaf);
    const focusRestored = vi.spyOn(restoredView.surface, "focusThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = restoredView;
    });
    const plugin = await pluginWithLeaves([restoredLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(focusRestored).toHaveBeenCalledWith("thread-1");
    expect(openCurrent).not.toHaveBeenCalled();
  });

  it("uses the most recent panel and otherwise falls back to the first panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const openFirst = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const recentLeaf = leaf();
    recentLeaf.view = chatView(CodexChatView, recentLeaf);
    const openRecent = vi.spyOn((recentLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, recentLeaf]);
    const mostRecentLeaf = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecentLeaf.mockReturnValue(recentLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");
    expect(openRecent).toHaveBeenCalledWith("thread-1");
    expect(openFirst).not.toHaveBeenCalled();

    openRecent.mockClear();
    mostRecentLeaf.mockReturnValue(null);
    await panels(plugin).openThreadInCurrentView("thread-2");
    expect(openFirst).toHaveBeenCalledWith("thread-2");
    expect(openRecent).not.toHaveBeenCalled();
  });

  it("loads a deferred current panel before opening the selected thread", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = view;
    });

    await panels(plugin).openThreadInCurrentView("selected-thread");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("selected-thread");
  });

  it("opens a thread in a new panel without a separate pre-connect", async () => {
    const newLeaf = leaf();
    const plugin = await pluginWithLeaves([]);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
    });
    const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);

    await panels(plugin).openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("thread-1");
  });

  it("activates and marks the active Codex panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn((firstLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    vi.spyOn(activeView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "active", threadId: "thread-2" }));
    const connect = vi.spyOn(activeView.surface, "connect").mockResolvedValue(undefined);
    const focus = vi.spyOn(activeView.surface, "focusThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);

    await expect(panels(plugin).activateView()).resolves.toBe(activeView);
    expect(connect).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(panels(plugin).getOpenPanelSnapshots()).toMatchObject([
      { viewId: "first", lastFocused: false },
      { viewId: "active", lastFocused: true },
    ]);
  });

  it("opens empty panels and side chats with their distinct startup contracts", async () => {
    const emptyLeaf = leaf();
    const sideLeaf = leaf();
    const plugin = await pluginWithLeaves([]);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const emptyView = chatView(CodexChatView, emptyLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const connect = vi.spyOn(emptyView.surface, "connect").mockResolvedValue(undefined);
    const openSideChat = vi.spyOn(sideView.surface, "openSideChat").mockResolvedValue(true);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(emptyLeaf).mockReturnValueOnce(sideLeaf);
    emptyLeaf.setViewState.mockImplementation(async () => {
      emptyLeaf.view = emptyView;
    });
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
    });

    await panels(plugin).openNewPanel();
    await panels(plugin).openSideChat("source", "Source thread");

    expect(connect).toHaveBeenCalledOnce();
    expect(sideLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      active: true,
      state: { version: 2, ephemeralSource: { threadId: "source", title: "Source thread" } },
    });
    expect(openSideChat).toHaveBeenCalledWith({ sourceThreadId: "source", sourceThreadTitle: "Source thread" });
  });
});

function panels(plugin: CodexPanelPlugin): WorkspacePanelCoordinator {
  return new WorkspacePanelCoordinator({ app: plugin.app, refreshThreadsViewLiveState: vi.fn() });
}
