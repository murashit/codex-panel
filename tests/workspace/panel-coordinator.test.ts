// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL } from "../../src/constants";
import type { CodexChatView } from "../../src/features/chat/host/view.obsidian";
import type CodexPanelPlugin from "../../src/main";
import { WorkspacePanelCoordinator } from "../../src/workspace/panel-coordinator";
import { deferred } from "../support/async";
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
      { threadId: "thread-1", connected: false, lastFocused: false, turnBusy: false, pending: false },
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

    expect(focus).toHaveBeenCalledWith("thread-1", { focus: false });
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
    expect(openEmpty).toHaveBeenCalledWith("thread-1", { focus: false });
  });

  it("focuses an already open history target even when its origin panel cannot switch", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const originLeaf = leaf();
    originLeaf.view = chatView(CodexChatView, originLeaf);
    vi.spyOn((originLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "origin", threadId: "origin-thread", turnBusy: true }),
    );
    const destinationLeaf = leaf();
    destinationLeaf.view = chatView(CodexChatView, destinationLeaf);
    vi.spyOn((destinationLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "destination", threadId: "target" }),
    );
    const focusDestination = vi.spyOn((destinationLeaf.view as CodexChatView).surface, "focusThread").mockResolvedValue(undefined);
    const openOrigin = vi.spyOn((originLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([originLeaf, destinationLeaf])).openThreadFromPanel("target", "origin", false);

    expect(focusDestination).toHaveBeenCalledWith("target", { focus: false });
    expect(openOrigin).not.toHaveBeenCalled();
  });

  it("prefers a switchable history origin over an idle empty panel", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const originLeaf = leaf();
    originLeaf.view = chatView(CodexChatView, originLeaf);
    vi.spyOn((originLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "origin", threadId: "origin-thread" }),
    );
    const openOrigin = vi.spyOn((originLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "empty", threadId: null }),
    );
    const openEmpty = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([originLeaf, emptyLeaf])).openThreadFromPanel("target", "origin", true);

    expect(openOrigin).toHaveBeenCalledWith("target", { focus: false });
    expect(openEmpty).not.toHaveBeenCalled();
  });

  it("uses an idle empty panel when a history origin cannot switch", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const originLeaf = leaf();
    originLeaf.view = chatView(CodexChatView, originLeaf);
    vi.spyOn((originLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "origin", threadId: "origin-thread", turnBusy: true }),
    );
    const openOrigin = vi.spyOn((originLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "empty", threadId: null }),
    );
    const openEmpty = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);

    await panels(await pluginWithLeaves([originLeaf, emptyLeaf])).openThreadFromPanel("target", "origin", false);

    expect(openOrigin).not.toHaveBeenCalled();
    expect(openEmpty).toHaveBeenCalledWith("target", { focus: false });
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

    expect(activeOpen).toHaveBeenCalledWith("thread-1", { focus: false });
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

    expect(focusDestination).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(openCurrent).not.toHaveBeenCalled();
  });

  it("restores an exact deferred destination before replacing the current panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "thread-1" } });
    const currentLeaf = leaf();
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    currentLeaf.view = chatView(CodexChatView, currentLeaf);
    const openCurrent = vi.spyOn((currentLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const restoredView = chatView(CodexChatView, restoredLeaf);
    vi.spyOn(restoredView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    const focusRestored = vi.spyOn(restoredView.surface, "focusThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = restoredView;
    });
    const plugin = await pluginWithLeaves([restoredLeaf, currentLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(currentLeaf);

    await panels(plugin).openThreadInCurrentView("thread-1");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(focusRestored).toHaveBeenCalledWith("thread-1", { focus: false });
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
    expect(openRecent).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(openFirst).not.toHaveBeenCalled();

    openRecent.mockClear();
    mostRecentLeaf.mockReturnValue(null);
    await panels(plugin).openThreadInCurrentView("thread-2");
    expect(openFirst).toHaveBeenCalledWith("thread-2", { focus: false });
    expect(openRecent).not.toHaveBeenCalled();
  });

  it("loads a deferred current panel before opening the selected thread", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    vi.spyOn(view.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "restored-thread" }));
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      restoredLeaf.view = view;
    });

    await panels(plugin).openThreadInCurrentView("selected-thread");

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("selected-thread", { focus: false });
  });

  it("does not open an older selection after a newer selection claims the same deferred panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, restoredLeaf);
    vi.spyOn(view.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "restored-thread" }));
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    const loading = deferred<void>();
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      await loading.promise;
      restoredLeaf.view = view;
    });
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce());
    const secondSelection = coordinator.openThreadInCurrentView("second");
    loading.resolve(undefined);
    await Promise.all([firstSelection, secondSelection]);

    expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("second", { focus: false });
  });

  it("lets the latest foreground selection win across different leaves", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstOpen = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondOpen = vi.spyOn((secondLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const mostRecent = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecent.mockReturnValue(firstLeaf);
    const firstReveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation((target) =>
      target === firstLeaf ? firstReveal.promise : Promise.resolve(),
    );
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(firstLeaf));
    mostRecent.mockReturnValue(secondLeaf);
    const secondSelection = coordinator.openThreadInCurrentView("second");
    firstReveal.resolve(undefined);
    await Promise.all([firstSelection, secondSelection]);

    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledOnce();
    expect(secondOpen).toHaveBeenCalledWith("second", { focus: false });
  });

  it("does not let stalled work in an older leaf block the latest foreground selection", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstWork = deferred<void>();
    const firstOpen = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockReturnValue(firstWork.promise);
    const firstFocus = vi.spyOn((firstLeaf.view as CodexChatView).surface, "focusComposer");
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondOpen = vi.spyOn((secondLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const secondFocus = vi.spyOn((secondLeaf.view as CodexChatView).surface, "focusComposer");
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const mostRecent = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecent.mockReturnValue(firstLeaf);
    const coordinator = panels(plugin);

    void coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(firstOpen).toHaveBeenCalledOnce());
    mostRecent.mockReturnValue(secondLeaf);
    await coordinator.openThreadInCurrentView("second");

    expect(secondOpen).toHaveBeenCalledWith("second", { focus: false });
    expect(secondFocus).toHaveBeenCalledOnce();
    expect(firstFocus).not.toHaveBeenCalled();
  });

  it("preserves a newer manual workspace selection after an older reveal finishes late", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstOpen = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondOpen = vi.spyOn((secondLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const manualLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const mostRecent = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecent.mockReturnValue(firstLeaf);
    const firstReveal = deferred<void>();
    const revealLeaf = plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>;
    revealLeaf.mockImplementation((target) => (target === firstLeaf ? firstReveal.promise : Promise.resolve()));
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(firstLeaf));
    mostRecent.mockReturnValue(secondLeaf);
    await coordinator.openThreadInCurrentView("second");
    coordinator.activeLeafChanged(manualLeaf as never);
    firstReveal.resolve(undefined);
    await firstSelection;

    expect(revealLeaf.mock.calls.map(([target]) => target)).toEqual([firstLeaf, secondLeaf]);
    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledOnce();
  });

  it("cancels pending coordinator work when its leaf is selected manually", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstOpen = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondOpen = vi.spyOn((secondLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const mostRecent = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecent.mockReturnValue(firstLeaf);
    const firstReveal = deferred<void>();
    const revealLeaf = plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>;
    revealLeaf.mockImplementation((target) => (target === firstLeaf ? firstReveal.promise : Promise.resolve()));
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(firstLeaf));
    mostRecent.mockReturnValue(secondLeaf);
    await coordinator.openThreadInCurrentView("second");
    coordinator.activeLeafChanged(firstLeaf as never);
    firstReveal.resolve(undefined);
    await firstSelection;

    expect(revealLeaf.mock.calls.map(([target]) => target)).toEqual([firstLeaf, secondLeaf]);
    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledOnce();
  });

  it("does not treat a coordinator reveal event as a competing manual intent", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const targetLeaf = leaf();
    targetLeaf.view = chatView(CodexChatView, targetLeaf);
    const open = vi.spyOn((targetLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([targetLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(targetLeaf);
    const coordinator = panels(plugin);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async (leafToReveal) => {
      coordinator.activeLeafChanged(leafToReveal);
    });

    await coordinator.openThreadInCurrentView("thread");

    expect(open).toHaveBeenCalledWith("thread", { focus: false });
  });

  it("keeps the last A selection after an A to B to A foreground race", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstOpen = vi.spyOn((firstLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondOpen = vi.spyOn((secondLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const mostRecent = plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>;
    mostRecent.mockReturnValue(firstLeaf);
    const firstReveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementationOnce(() => firstReveal.promise);
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInCurrentView("first");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledOnce());
    mostRecent.mockReturnValue(secondLeaf);
    const secondSelection = coordinator.openThreadInCurrentView("second");
    mostRecent.mockReturnValue(firstLeaf);
    const finalSelection = coordinator.openThreadInCurrentView("final");
    firstReveal.resolve(undefined);
    await Promise.all([firstSelection, secondSelection, finalSelection]);

    expect(firstOpen).toHaveBeenCalledOnce();
    expect(firstOpen).toHaveBeenCalledWith("final", { focus: false });
    expect(secondOpen).not.toHaveBeenCalled();
  });

  it("does not publish into a view replaced while its leaf is being revealed", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const targetLeaf = leaf();
    const originalView = chatView(CodexChatView, targetLeaf);
    targetLeaf.view = originalView;
    const originalOpen = vi.spyOn(originalView.surface, "openThread").mockResolvedValue(undefined);
    const replacementView = chatView(CodexChatView, targetLeaf);
    const replacementOpen = vi.spyOn(replacementView.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([targetLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(targetLeaf);
    const reveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);

    const opening = panels(plugin).openThreadInCurrentView("thread");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(targetLeaf));
    targetLeaf.view = replacementView;
    reveal.resolve(undefined);
    await opening;

    expect(originalOpen).not.toHaveBeenCalled();
    expect(replacementOpen).not.toHaveBeenCalled();
  });

  it("does not continue an intent started by a replaced execution runtime", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const targetLeaf = leaf();
    const view = chatView(CodexChatView, targetLeaf);
    targetLeaf.view = view;
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([targetLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(targetLeaf);
    const reveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);
    const coordinator = panels(plugin);

    const opening = coordinator.openThreadInCurrentView("thread");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(targetLeaf));
    coordinator.invalidateRuntimeIntents();
    reveal.resolve(undefined);
    await opening;

    expect(open).not.toHaveBeenCalled();
  });

  it("rejects a deferred restored target that materializes as a different panel", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const replacementView = chatView(CodexChatView, restoredLeaf);
    vi.spyOn(replacementView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "other-thread" }));
    const replacementOpen = vi.spyOn(replacementView.surface, "openThread").mockResolvedValue(undefined);
    const loading = deferred<void>();
    restoredLeaf.loadIfDeferred.mockImplementation(async () => {
      await loading.promise;
      restoredLeaf.view = replacementView;
    });

    const opening = panels(plugin).openThreadInCurrentView("selected-thread");
    await vi.waitFor(() => expect(restoredLeaf.loadIfDeferred).toHaveBeenCalledOnce());
    loading.resolve(undefined);
    await opening;

    expect(replacementOpen).not.toHaveBeenCalled();
  });

  it("does not publish into a leaf detached while it is being revealed", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const targetLeaf = leaf();
    targetLeaf.view = chatView(CodexChatView, targetLeaf);
    const open = vi.spyOn((targetLeaf.view as CodexChatView).surface, "openThread").mockResolvedValue(undefined);
    const leaves = [targetLeaf];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(targetLeaf);
    const reveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);

    const opening = panels(plugin).openThreadInCurrentView("thread");
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(targetLeaf));
    leaves.splice(0, 1);
    reveal.resolve(undefined);
    await opening;

    expect(open).not.toHaveBeenCalled();
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
    const open = vi.spyOn(view.surface, "openThread").mockResolvedValue(undefined);

    await panels(plugin).openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("thread-1", { focus: false });
  });

  it("does not connect or focus a new panel detached while it is being revealed", async () => {
    const newLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const view = chatView(CodexChatView, newLeaf);
    const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
    const focus = vi.spyOn(view.surface, "focusComposer");
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
      leaves.push(newLeaf);
    });
    const reveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);

    const opening = panels(plugin).openNewPanel();
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf));
    leaves.splice(0, 1);
    reveal.resolve(undefined);
    await opening;

    expect(connect).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not connect or focus a new panel whose view is replaced during reveal", async () => {
    const newLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const originalView = chatView(CodexChatView, newLeaf);
    const replacementView = chatView(CodexChatView, newLeaf);
    const originalConnect = vi.spyOn(originalView.surface, "connect").mockResolvedValue(undefined);
    const originalFocus = vi.spyOn(originalView.surface, "focusComposer");
    const replacementFocus = vi.spyOn(replacementView.surface, "focusComposer");
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = originalView;
      leaves.push(newLeaf);
    });
    const reveal = deferred<void>();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);

    const opening = panels(plugin).openNewPanel();
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf));
    newLeaf.view = replacementView;
    reveal.resolve(undefined);
    await opening;

    expect(originalConnect).not.toHaveBeenCalled();
    expect(originalFocus).not.toHaveBeenCalled();
    expect(replacementFocus).not.toHaveBeenCalled();
  });

  it("does not open an older thread after a newer intent arrives during new leaf hydration", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstLeaf).mockReturnValueOnce(secondLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    const firstOpen = vi.spyOn(firstView.surface, "openThread").mockResolvedValue(undefined);
    const secondOpen = vi.spyOn(secondView.surface, "openThread").mockResolvedValue(undefined);
    const hydration = deferred<void>();
    firstLeaf.setViewState.mockImplementation(async () => {
      await hydration.promise;
      firstLeaf.view = firstView;
      leaves.push(firstLeaf);
    });
    secondLeaf.setViewState.mockImplementation(async () => {
      secondLeaf.view = secondView;
      leaves.push(secondLeaf);
    });
    const coordinator = panels(plugin);

    const firstSelection = coordinator.openThreadInNewView("first");
    await vi.waitFor(() => expect(firstLeaf.setViewState).toHaveBeenCalledOnce());
    const secondSelection = coordinator.openThreadInNewView("second");
    hydration.resolve(undefined);
    await Promise.all([firstSelection, secondSelection]);

    expect(firstOpen).not.toHaveBeenCalled();
    expect(firstLeaf.detach).toHaveBeenCalledOnce();
    expect(secondOpen).toHaveBeenCalledOnce();
    expect(secondOpen).toHaveBeenCalledWith("second", { focus: false });
  });

  it("lets side-chat activation supersede older foreground thread opens", async () => {
    const threadLeaf = leaf();
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(threadLeaf).mockReturnValueOnce(sideLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const threadView = chatView(CodexChatView, threadLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const openThread = vi.spyOn(threadView.surface, "openThread").mockResolvedValue(undefined);
    const openSideChat = vi.spyOn(sideView.surface, "openSideChat").mockResolvedValue(true);
    const hydration = deferred<void>();
    threadLeaf.setViewState.mockImplementation(async () => {
      await hydration.promise;
      threadLeaf.view = threadView;
      leaves.push(threadLeaf);
    });
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });
    const coordinator = panels(plugin);

    const threadOpening = coordinator.openThreadInNewView("thread");
    await vi.waitFor(() => expect(threadLeaf.setViewState).toHaveBeenCalledOnce());
    const sideOpening = coordinator.openSideChat("source", "Source");
    hydration.resolve(undefined);
    await Promise.all([threadOpening, sideOpening]);

    expect(openThread).not.toHaveBeenCalled();
    expect(openSideChat).toHaveBeenCalledWith({ sourceThreadId: "source", sourceThreadTitle: "Source" }, { focus: false });
  });

  it("does not focus a blank side panel when side-chat creation fails", async () => {
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(sideLeaf);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const sideView = chatView(CodexChatView, sideLeaf);
    const focus = vi.spyOn(sideView.surface, "focusComposer");
    vi.spyOn(sideView.surface, "openSideChat").mockResolvedValue(false);
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });

    await panels(plugin).openSideChat("source", "Source");

    expect(focus).not.toHaveBeenCalled();
    expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledOnce();
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

  it("keeps a newer panel foreground while an older start-new-chat operation finishes", async () => {
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstView = firstLeaf.view as CodexChatView;
    vi.spyOn(firstView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "first" }));
    vi.spyOn(firstView.surface, "connect").mockResolvedValue(undefined);
    vi.spyOn(firstView.surface, "focusThread").mockResolvedValue(undefined);
    const firstFocus = vi.spyOn(firstView.surface, "focusComposer");
    const starting = deferred<void>();
    const startNewThread = vi.spyOn(firstView.surface, "startNewThread").mockReturnValue(starting.promise);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondView = secondLeaf.view as CodexChatView;
    vi.spyOn(secondView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "second" }));
    const secondFocus = vi.spyOn(secondView.surface, "focusComposer");
    vi.spyOn(secondView.surface, "focusThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(firstLeaf);
    const coordinator = panels(plugin);

    const oldStart = coordinator.startNewChat();
    await vi.waitFor(() => expect(startNewThread).toHaveBeenCalledWith({ focus: false }));
    await expect(coordinator.focusOpenPanel("second")).resolves.toBe(true);
    starting.resolve(undefined);
    await oldStart;

    expect(secondFocus).toHaveBeenCalledOnce();
    expect(firstFocus).toHaveBeenCalledOnce();
    expect(secondFocus.mock.invocationCallOrder[0]).toBeGreaterThan(firstFocus.mock.invocationCallOrder[0] ?? 0);
  });

  it("opens empty panels and side chats with their distinct startup contracts", async () => {
    const emptyLeaf = leaf();
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    const { CodexChatView } = await import("../../src/features/chat/host/view.obsidian");
    const emptyView = chatView(CodexChatView, emptyLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const connect = vi.spyOn(emptyView.surface, "connect").mockResolvedValue(undefined);
    const openSideChat = vi.spyOn(sideView.surface, "openSideChat").mockResolvedValue(true);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(emptyLeaf).mockReturnValueOnce(sideLeaf);
    emptyLeaf.setViewState.mockImplementation(async () => {
      emptyLeaf.view = emptyView;
      leaves.push(emptyLeaf);
    });
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });

    await panels(plugin).openNewPanel();
    await panels(plugin).openSideChat("source", "Source thread");

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
