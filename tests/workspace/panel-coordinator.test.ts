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

  it("cancels a pending restored-panel reconciliation on reset", async () => {
    vi.useFakeTimers();
    const panelLeaf = leaf();
    const coordinator = panels(await pluginWithLeaves([panelLeaf]));

    coordinator.scheduleWorkspacePanelReconcile();
    coordinator.reset();
    await vi.advanceTimersByTimeAsync(0);

    expect(panelLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("includes deferred restored panels in snapshots", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const coordinator = panels(await pluginWithLeaves([restoredLeaf]));

    expect(coordinator.getOpenPanelSnapshots()).toMatchObject([
      { threadId: "thread-1", connected: false, lastFocused: false, turnBusy: false, pending: false },
    ]);
  });

  it("repairs duplicate restored thread panels before they become active", async () => {
    const firstLeaf = leaf({ state: { threadId: "thread-1" } });
    const duplicateLeaf = leaf({ state: { threadId: "thread-1" } });
    const coordinator = panels(await pluginWithLeaves([firstLeaf, duplicateLeaf]));

    expect(coordinator.getOpenPanelSnapshots()).toHaveLength(1);
    expect(duplicateLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      state: { version: 1 },
    });
  });

  it("detaches duplicate materialized thread panels while keeping the active owner", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    vi.spyOn((firstLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "first", threadId: "thread-1" }),
    );
    const duplicateLeaf = leaf();
    duplicateLeaf.view = chatView(CodexChatView, duplicateLeaf);
    vi.spyOn((duplicateLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "duplicate", threadId: "thread-1" }),
    );
    const coordinator = panels(await pluginWithLeaves([firstLeaf, duplicateLeaf]));

    expect(coordinator.getOpenPanelSnapshots()).toHaveLength(1);
    expect(duplicateLeaf.detach).toHaveBeenCalledOnce();
  });

  it("prefers an already open thread over an idle panel", async () => {
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

    await panels(await pluginWithLeaves([openLeaf, emptyLeaf])).openThreadInAvailableView("thread-1");

    expect(focus).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not create a second panel when opening an already owned thread in a new view", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const existingLeaf = leaf();
    existingLeaf.view = chatView(CodexChatView, existingLeaf);
    const existingView = existingLeaf.view as CodexChatView;
    vi.spyOn(existingView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "existing", threadId: "thread-1" }));
    const focus = vi.spyOn(existingView.surface, "focusThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([existingLeaf]);
    const coordinator = panels(plugin);

    await coordinator.openThreadInNewView("thread-1");

    expect(focus).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(plugin.app.workspace.getRightLeaf).not.toHaveBeenCalled();
  });

  it("reuses only a genuinely idle empty panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const pendingLeaf = leaf();
    pendingLeaf.view = chatView(CodexChatView, pendingLeaf);
    vi.spyOn((pendingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "pending", threadId: null, pendingMcpElicitations: 1 }),
    );
    const pendingOpen = vi.spyOn((pendingLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "empty", threadId: null }),
    );
    const emptyOpen = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([pendingLeaf, emptyLeaf])).openThreadInAvailableView("thread-1");

    expect(pendingOpen).not.toHaveBeenCalled();
    expect(emptyOpen).toHaveBeenCalledWith("thread-1", { focus: false });
  });

  it("uses a switchable origin before another empty panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const originLeaf = leaf();
    originLeaf.view = chatView(CodexChatView, originLeaf);
    vi.spyOn((originLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "origin", threadId: "source" }),
    );
    const originOpen = vi.spyOn((originLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "empty", threadId: null }),
    );
    const emptyOpen = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([originLeaf, emptyLeaf])).openThreadFromPanel("target", "origin", true);

    expect(originOpen).toHaveBeenCalledWith("target", { focus: false });
    expect(emptyOpen).not.toHaveBeenCalled();
  });

  it("opens a restored current panel after reveal materializes it", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      restoredLeaf.view = view;
    });

    await panels(plugin).openThreadInCurrentView("selected-thread");

    expect(open).toHaveBeenCalledWith("selected-thread", { focus: false });
  });

  it("keeps deferred content work independent across different panels", async () => {
    const firstLeaf = leaf({ state: { threadId: "first" } });
    const secondLeaf = leaf({ state: { threadId: "second" } });
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    const firstFocusThread = vi.spyOn(firstView.surface, "focusThread").mockResolvedValue(undefined);
    const secondFocusThread = vi.spyOn(secondView.surface, "focusThread").mockResolvedValue(undefined);
    const firstFocusComposer = vi.spyOn(firstView.surface, "focusComposer");
    const secondFocusComposer = vi.spyOn(secondView.surface, "focusComposer");
    const firstReveal = deferred();
    const secondReveal = deferred();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async (target) => {
      if (target === firstLeaf) {
        await firstReveal.promise;
        firstLeaf.view = firstView;
      } else {
        await secondReveal.promise;
        secondLeaf.view = secondView;
      }
    });
    const coordinator = panels(plugin);

    const firstOpen = coordinator.openThreadInAvailableView("first");
    const secondOpen = coordinator.openThreadInAvailableView("second");
    secondReveal.resolve();
    firstReveal.resolve();
    await Promise.all([firstOpen, secondOpen]);

    expect(firstFocusThread).toHaveBeenCalledWith("first", { focus: false });
    expect(secondFocusThread).toHaveBeenCalledWith("second", { focus: false });
    expect(firstFocusComposer).toHaveBeenCalledOnce();
    expect(secondFocusComposer).toHaveBeenCalledOnce();
  });

  it("starts a new chat through the current panel's normal activation path", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const view = panelLeaf.view as CodexChatView;
    const start = vi.spyOn(view.surface, "startNewThread").mockResolvedValue(undefined);
    const focus = vi.spyOn(view.surface, "focusComposer");
    const plugin = await pluginWithLeaves([panelLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(panelLeaf);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      expect(start).toHaveBeenCalledWith({ focus: false });
    });

    await panels(plugin).startNewChat();

    expect(start).toHaveBeenCalledWith({ focus: false });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("focuses a listed panel through its public view-id route", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const view = panelLeaf.view as CodexChatView;
    vi.spyOn(view.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "listed", threadId: "old" }));
    const focusThread = vi.spyOn(view.surface, "focusThread").mockResolvedValue(undefined);
    const focusComposer = vi.spyOn(view.surface, "focusComposer");

    const focused = await panels(await pluginWithLeaves([panelLeaf])).focusOpenPanel("listed", "selected");

    expect(focused).toBe(true);
    expect(focusThread).toHaveBeenCalledWith("selected", { focus: false });
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("hydrates the foreground restored panel during normal reconciliation", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    const hydrate = vi.spyOn(view.surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = view;
    });

    panels(plugin).reconcileWorkspacePanels();
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("lets independent new-panel requests both complete", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstLeaf).mockReturnValueOnce(secondLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    const firstOpen = vi.spyOn(firstView.surface, "focusThread").mockResolvedValue(undefined);
    const secondOpen = vi.spyOn(secondView.surface, "focusThread").mockResolvedValue(undefined);
    const firstFocus = vi.spyOn(firstView.surface, "focusComposer");
    const secondFocus = vi.spyOn(secondView.surface, "focusComposer");
    firstLeaf.setViewState.mockImplementation(async () => {
      firstLeaf.view = firstView;
      leaves.push(firstLeaf);
    });
    secondLeaf.setViewState.mockImplementation(async () => {
      secondLeaf.view = secondView;
      leaves.push(secondLeaf);
    });
    const coordinator = panels(plugin);

    await Promise.all([coordinator.openThreadInNewView("first"), coordinator.openThreadInNewView("second")]);

    expect(firstOpen).toHaveBeenCalledWith("first", { focus: false });
    expect(secondOpen).toHaveBeenCalledWith("second", { focus: false });
    expect(firstFocus).toHaveBeenCalledOnce();
    expect(secondFocus).toHaveBeenCalledOnce();
  });

  it("serializes same-thread new-panel requests onto one owner", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstLeaf).mockReturnValueOnce(secondLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    vi.spyOn(firstView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "first", threadId: "same-thread" }));
    const firstOpen = vi.spyOn(firstView.surface, "focusThread").mockResolvedValue(undefined);
    const secondOpen = vi.spyOn(secondView.surface, "focusThread").mockResolvedValue(undefined);
    firstLeaf.setViewState.mockImplementation(async () => {
      firstLeaf.view = firstView;
      leaves.push(firstLeaf);
    });
    secondLeaf.setViewState.mockImplementation(async () => {
      secondLeaf.view = secondView;
      leaves.push(secondLeaf);
    });
    const coordinator = panels(plugin);

    await Promise.all([coordinator.openThreadInNewView("same-thread"), coordinator.openThreadInNewView("same-thread")]);

    expect(firstOpen).toHaveBeenCalledWith("same-thread", { focus: false });
    expect(secondOpen).not.toHaveBeenCalled();
    expect(secondLeaf.setViewState).not.toHaveBeenCalled();
  });

  it("allows overlapping same-panel thread work to finish", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const view = panelLeaf.view as CodexChatView;
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    const focus = vi.spyOn(view.surface, "focusComposer");
    const plugin = await pluginWithLeaves([panelLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(panelLeaf);
    const firstReveal = deferred();
    const secondReveal = deferred();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstReveal.promise)
      .mockReturnValueOnce(secondReveal.promise);
    const coordinator = panels(plugin);

    const firstOpen = coordinator.openThreadInCurrentView("first");
    const secondOpen = coordinator.openThreadInCurrentView("second");
    await vi.waitFor(() => {
      expect(open).toHaveBeenNthCalledWith(1, "first", { focus: false });
      expect(open).toHaveBeenNthCalledWith(2, "second", { focus: false });
    });
    secondReveal.resolve();
    coordinator.activeLeafChanged(panelLeaf as never);
    firstReveal.resolve();
    await Promise.all([firstOpen, secondOpen]);

    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("opens a thread in a new panel without a separate pre-connect", async () => {
    const newLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
      leaves.push(newLeaf);
    });
    const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
    const open = vi.spyOn(view.surface, "focusThread").mockResolvedValue(undefined);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      expect(open).toHaveBeenCalledWith("thread-1", { focus: false });
    });

    await panels(plugin).openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(newLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      active: false,
      state: { version: 1, threadId: "thread-1" },
    });
    expect(open).toHaveBeenCalledWith("thread-1", { focus: false });
  });

  it("reveals a pending side chat immediately without focusing it when creation fails", async () => {
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(sideLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const sideView = chatView(CodexChatView, sideLeaf);
    const focus = vi.spyOn(sideView.surface, "focusComposer");
    let resolveOpening!: (opened: boolean) => void;
    vi.spyOn(sideView.surface, "openSideChat").mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveOpening = resolve;
      }),
    );
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });

    const opening = panels(plugin).openSideChat("source", "Source");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(sideLeaf));
    expect(focus).not.toHaveBeenCalled();
    resolveOpening(false);
    await opening;

    expect(focus).not.toHaveBeenCalled();
  });

  it("tracks the active Codex panel in shared snapshots", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const activeLeaf = leaf();
    activeLeaf.view = chatView(CodexChatView, activeLeaf);
    const activeView = activeLeaf.view as CodexChatView;
    vi.spyOn(activeView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "active", threadId: "thread" }));
    const plugin = await pluginWithLeaves([firstLeaf, activeLeaf]);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(activeView);
    const coordinator = panels(plugin);

    coordinator.activeLeafChanged(activeLeaf as never);

    expect(coordinator.getOpenPanelSnapshots()).toEqual(
      expect.arrayContaining([expect.objectContaining({ viewId: "active", lastFocused: true })]),
    );
  });

  it("keeps regular panels and side chats on distinct startup paths", async () => {
    const regularLeaf = leaf();
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(regularLeaf).mockReturnValueOnce(sideLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const regularView = chatView(CodexChatView, regularLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const connect = vi.spyOn(regularView.surface, "connect").mockResolvedValue(undefined);
    const openSideChat = vi.spyOn(sideView.surface, "openSideChat").mockResolvedValue(true);
    regularLeaf.setViewState.mockImplementation(async () => {
      regularLeaf.view = regularView;
      leaves.push(regularLeaf);
    });
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });
    const coordinator = panels(plugin);

    await coordinator.openNewPanel();
    await coordinator.openSideChat("source", "Source thread");

    expect(connect).toHaveBeenCalledOnce();
    expect(sideLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      active: false,
      state: { version: 2, ephemeralSource: { threadId: "source", title: "Source thread" } },
    });
    expect(openSideChat).toHaveBeenCalledWith({ sourceThreadId: "source", sourceThreadTitle: "Source thread" }, { focus: false });
  });
});

function panels(plugin: CodexPanelPlugin): WorkspacePanelCoordinator {
  return new WorkspacePanelCoordinator({ app: plugin.app, refreshThreadsViewLiveState: vi.fn() });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
