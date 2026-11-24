// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEW_TYPE_CODEX_PANEL } from "../../src/constants";
import { createChatState } from "../../src/features/chat/application/state/model";
import type { ForkDraftPreparation } from "../../src/features/chat/application/threads/fork-draft";
import { sideChatDraft } from "../../src/features/chat/application/threads/fork-draft";
import { CodexChatView } from "../../src/features/chat/host/view.obsidian";
import type CodexPanelPlugin from "../../src/main";
import { WorkspacePanelCoordinator } from "../../src/workspace/panel-coordinator";
import { deferred, eventOrders } from "../support/async";
import { installObsidianDomShims } from "../support/dom";
import { chatView, leaf, panelSnapshot, pluginWithLeaves } from "../support/plugin-fixtures";

installObsidianDomShims();

describe("WorkspacePanelCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops a scoped selection after empty-leaf creation without persisting its thread", async () => {
    const target = leaf();
    const leaves: ReturnType<typeof leaf>[] = [];
    const plugin = await pluginWithLeaves(leaves);
    const view = chatView(CodexChatView, target);
    const activated = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    const pending = deferred<void>();
    target.setViewState.mockImplementation(async () => {
      target.view = view;
      leaves.push(target);
      await pending.promise;
    });
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(target);
    const controller = new AbortController();
    const scoped = panels(plugin).forRuntime(controller.signal);
    const opening = scoped.openThreadInNewView("old-thread");
    await vi.waitFor(() => {
      expect(target.setViewState).toHaveBeenCalledOnce();
    });
    controller.abort();
    pending.resolve();
    await opening;
    expect(target.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CODEX_PANEL, active: false, state: { version: 1 } });
    expect(activated).not.toHaveBeenCalled();
    expect(target.detach).not.toHaveBeenCalled();
    plugin.runtime.reset();
  });

  it("keeps thread opens independent while the first panel materializes", async () => {
    const first = leaf();
    const second = leaf();
    const leaves: ReturnType<typeof leaf>[] = [];
    const plugin = await pluginWithLeaves(leaves);
    const firstView = chatView(CodexChatView, first);
    const secondView = chatView(CodexChatView, second);
    const pending = deferred<void>();
    const firstActivation = vi.spyOn(firstView.surface, "activateThread").mockResolvedValue(true);
    const secondActivation = vi.spyOn(secondView.surface, "activateThread").mockResolvedValue(true);
    first.setViewState.mockImplementation(async () => {
      first.view = firstView;
      leaves.push(first);
      await pending.promise;
    });
    installLeafView(second, secondView, leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const coordinator = panels(plugin);
    const one = coordinator.openThreadInNewView("one");
    await vi.waitFor(() => {
      expect(first.setViewState).toHaveBeenCalledOnce();
    });
    await coordinator.openThreadInAvailableView("two");
    expect(secondActivation).toHaveBeenCalledWith("two", { focus: false });
    pending.resolve();
    await one;
    expect(firstActivation).toHaveBeenCalledTimes(1);
    expect(firstActivation).toHaveBeenCalledWith("one", { focus: false });
    plugin.runtime.reset();
  });

  it("records focus on activation while snapshot reads stay passive", async () => {
    const restored = leaf({ state: { threadId: "same" } });
    const active = leaf();
    active.view = chatView(CodexChatView, active);
    vi.spyOn((active.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "active", threadId: "same" }),
    );
    const independent = leaf({ state: { threadId: "other" } });
    const plugin = await pluginWithLeaves([restored, independent, active]);
    const activeView = plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>;
    activeView.mockReturnValue(active.view);
    const coordinator = panels(plugin);
    expect(coordinator.getOpenPanelSnapshots()).toMatchObject([
      { threadId: "other", connected: false, lastFocused: false, turnBusy: false, pending: false },
      { viewId: "active", lastFocused: true },
    ]);
    activeView.mockReturnValue(null);
    expect(coordinator.getOpenPanelSnapshots()).toMatchObject([
      { threadId: "other", lastFocused: false },
      { viewId: "active", lastFocused: false },
    ]);
    for (const target of [restored, independent, active]) {
      expect(target.detach).not.toHaveBeenCalled();
      expect(target.setViewState).not.toHaveBeenCalled();
      expect(target.loadIfDeferred).not.toHaveBeenCalled();
    }

    vi.spyOn((active.view as CodexChatView).surface, "activateThread").mockResolvedValue(true);
    coordinator.activeLeafChanged(active as never);
    expect(coordinator.getOpenPanelSnapshots()).toMatchObject([
      { threadId: "other", lastFocused: false },
      { viewId: "active", lastFocused: true },
    ]);
  });

  it.each(eventOrders("first", "second", "repair"))(
    "retains one owner when two restored leaves materialize around repair for $order",
    async ({ order }) => {
      const first = leaf({ state: { threadId: "shared" } });
      const second = leaf({ state: { threadId: "shared" } });
      const leaves = [first, second];
      const coordinator = panels(await pluginWithLeaves(leaves));
      const entries = { first, second };
      for (const panel of leaves) {
        panel.setViewState.mockImplementation(async (state: ReturnType<typeof panel.getViewState>) => {
          panel.getViewState.mockReturnValue(state);
        });
        panel.detach.mockImplementation(() => leaves.splice(leaves.indexOf(panel), 1));
      }
      for (const event of order) {
        if (event === "repair") coordinator.reconcileWorkspacePanels(null, "repair");
        else {
          const panel = entries[event];
          const view = chatView(CodexChatView, panel);
          const id = panel.getViewState().state["threadId"];
          vi.spyOn(view.surface, "openPanelSnapshot").mockReturnValue(
            panelSnapshot({ viewId: event, threadId: typeof id === "string" ? id : null }),
          );
          panel.view = view;
        }
      }
      const winner = order[0] === "second" && order[1] === "repair" ? "second" : "first";
      const owners = () => leaves.filter((panel) => (panel.view as CodexChatView).surface.openPanelSnapshot().threadId === "shared");
      expect(owners()).toEqual([entries[winner]]);
      coordinator.reconcileWorkspacePanels(null, "repair");
      expect(owners()).toEqual([entries[winner]]);
      const repairs = [first, second].flatMap((panel) => [...panel.detach.mock.calls, ...panel.setViewState.mock.calls]);
      expect(repairs).toHaveLength(1);
    },
  );

  it("coalesces repair without hydration and captures the current layout when it runs", async () => {
    const first = leaf({ state: { threadId: "same" } });
    const duplicate = leaf({ state: { threadId: "same" } });
    const leaves = [first];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(first);
    const coordinator = panels(plugin);
    coordinator.scheduleWorkspacePanelReconcile({ restore: false });
    coordinator.scheduleWorkspacePanelReconcile({ restore: false });
    leaves.push(duplicate);
    expect(duplicate.setViewState).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(duplicate.setViewState).toHaveBeenCalledOnce();
    expect(first.loadIfDeferred).not.toHaveBeenCalled();
    expect(duplicate.loadIfDeferred).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves full restoration when repair is requested %s first", async (repairFirst) => {
    const restored = leaf({ state: { threadId: "one" } });
    const coordinator = panels(await pluginWithLeaves([restored]));
    coordinator.scheduleWorkspacePanelReconcile({ restore: !repairFirst });
    coordinator.scheduleWorkspacePanelReconcile({ restore: repairFirst });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(restored.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("suppresses outstanding restoration writes and allows an independent repair after failure", async () => {
    const first = leaf({ state: { threadId: "same" } });
    const duplicate = leaf({ state: { threadId: "same" } });
    const write = deferred<void>();
    duplicate.setViewState.mockReturnValueOnce(write.promise);
    const coordinator = panels(await pluginWithLeaves([first, duplicate]));
    coordinator.reconcileWorkspacePanels();
    coordinator.reconcileWorkspacePanels();
    expect(duplicate.setViewState).toHaveBeenCalledOnce();
    expect(duplicate.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CODEX_PANEL, state: { version: 1 } });
    write.reject(new Error("Host write failed"));
    await write.promise.catch(() => undefined);
    expect(coordinator.getOpenPanelSnapshots()).toHaveLength(1);
    expect(duplicate.setViewState).toHaveBeenCalledOnce();
    coordinator.reconcileWorkspacePanels();
    expect(duplicate.setViewState).toHaveBeenCalledTimes(2);
  });

  it("creates and connects a side panel when no panel is available", async () => {
    const { plugin, view, connect, focus } = await sidePanelFixture();

    const activated = await panels(plugin).activateView();

    expect(activated).toBe(view);
    expect(plugin.app.workspace.ensureSideLeaf).toHaveBeenCalledWith(VIEW_TYPE_CODEX_PANEL, "right", {
      active: false,
      reveal: false,
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ force: true });
  });

  it.each(["open", "new chat"] as const)("uses the restored recent panel for %s with another panel available", async (command) => {
    const restored = leaf({ state: { threadId: "saved" } });
    const other = materializedPanel(panelSnapshot({ viewId: "other", threadId: "independent" }));
    const leaves = [other.panelLeaf, restored];
    const plugin = await pluginWithLeaves(leaves);
    const view = chatView(CodexChatView, restored);
    const connecting = deferred<void>();
    const connect = vi.spyOn(view.surface, "connect").mockReturnValue(connecting.promise);
    const hydrate = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    const start = vi.spyOn(view.surface, "startNewThread").mockResolvedValue(undefined);
    const focus = vi.spyOn(view.surface, "focusComposer");
    vi.mocked(plugin.app.workspace.getMostRecentLeaf).mockReturnValue(restored as never);
    vi.mocked(plugin.app.workspace.revealLeaf).mockImplementation(async (target) => {
      if (target === (restored as unknown)) restored.view = view;
    });
    const coordinator = panels(plugin);
    const opening = command === "open" ? coordinator.activateView() : coordinator.startNewChat();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    expect(focus).not.toHaveBeenCalled();
    connecting.resolve();
    await opening;
    expect(hydrate).toHaveBeenCalledWith(undefined, { focus: false });
    expect(start.mock.calls.length > 0).toBe(command === "new chat");
    expect(focus).toHaveBeenCalledWith({ force: true });
    expect(other.activateThread).not.toHaveBeenCalled();
  });

  it("leaves a retired session alone when its connection settles", async () => {
    const panel = leaf();
    const plugin = await pluginWithLeaves([panel]);
    const view = chatView(CodexChatView, panel);
    panel.view = view;
    const connecting = deferred<void>();
    const connect = vi.spyOn(view.surface, "connect").mockReturnValue(connecting.promise);
    const hydrate = vi.spyOn(view.surface, "activateThread");
    const focus = vi.spyOn(view.surface, "focusComposer");
    const opening = panels(plugin).activateView();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    await view.detachRuntime();
    plugin.runtime.attachChatView(view);
    connecting.resolve();
    await expect(opening).resolves.toBeNull();
    expect(hydrate).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not connect a panel that was replaced during reveal", async () => {
    const { leaves, plugin, connect, focus } = await sidePanelFixture();
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      leaves.splice(0, 1);
    });

    await expect(panels(plugin).activateView()).resolves.toBeNull();

    expect(connect).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("retries a failed restored-panel load and hydrates the recovered view", async () => {
    const restored = leaf({ state: { threadId: "recoverable" } });
    const plugin = await pluginWithLeaves([restored]);
    const coordinator = panels(plugin);
    const pending = deferred<void>();
    const view = chatView(CodexChatView, restored);
    const activate = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    restored.loadIfDeferred.mockReturnValueOnce(pending.promise).mockImplementationOnce(async () => {
      restored.view = view;
    });

    coordinator.reconcileWorkspacePanels(null, "restore");
    expect(restored.loadIfDeferred).toHaveBeenCalledOnce();
    pending.reject(new Error("Transient host failure"));
    await pending.promise.catch(() => undefined);
    coordinator.reconcileWorkspacePanels(null, "restore");
    await Promise.resolve();

    expect(restored.loadIfDeferred).toHaveBeenCalledTimes(2);
    expect(restored.view).toBe(view);
    coordinator.activeLeafChanged(restored as never);
    expect(activate).toHaveBeenCalledWith(undefined, { focus: false });
    plugin.runtime.reset();
  });

  it("deduplicates concurrent restored-panel loads for each leaf", async () => {
    const firstLeaf = leaf({ state: { threadId: "first" } });
    const secondLeaf = leaf({ state: { threadId: "second" } });
    const firstLoad = deferred<void>();
    const secondLoad = deferred<void>();
    firstLeaf.loadIfDeferred.mockReturnValue(firstLoad.promise);
    secondLeaf.loadIfDeferred.mockReturnValue(secondLoad.promise);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const coordinator = panels(plugin);

    coordinator.reconcileWorkspacePanels(null, "restore");
    coordinator.reconcileWorkspacePanels(null, "restore");

    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    firstLoad.resolve();
    secondLoad.resolve();
    await Promise.all([firstLoad.promise, secondLoad.promise]);
  });

  it("prefers an already open thread over an idle panel", async () => {
    const { panelLeaf: openLeaf, activateThread: focus } = materializedPanel(panelSnapshot({ viewId: "open", threadId: "thread-1" }));
    const emptyLeaf = leaf();
    emptyLeaf.view = chatView(CodexChatView, emptyLeaf);
    const open = vi.spyOn((emptyLeaf.view as CodexChatView).surface, "activateThread").mockResolvedValue(true);

    await panels(await pluginWithLeaves([openLeaf, emptyLeaf])).openThreadInAvailableView("thread-1");

    expect(focus).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not create a second panel when opening an already owned thread in a new view", async () => {
    const existingLeaf = leaf();
    existingLeaf.view = chatView(CodexChatView, existingLeaf);
    const existingView = existingLeaf.view as CodexChatView;
    vi.spyOn(existingView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "existing", threadId: "thread-1" }));
    const focus = vi.spyOn(existingView.surface, "activateThread").mockResolvedValue(true);
    const plugin = await pluginWithLeaves([existingLeaf]);
    const coordinator = panels(plugin);

    await coordinator.openThreadInNewView("thread-1");

    expect(focus).toHaveBeenCalledWith("thread-1", { focus: false });
    expect(plugin.app.workspace.getRightLeaf).not.toHaveBeenCalled();
  });

  it.each([{ pending: true }, { hasForkDraft: true }, { hasComposerDraft: true }])(
    "does not reuse an occupied panel with %j",
    async (occupation) => {
      const { panelLeaf: pendingLeaf, activateThread: pendingOpen } = materializedPanel(
        panelSnapshot({ viewId: "pending", threadId: null, ...occupation }),
      );
      const { panelLeaf: emptyLeaf, activateThread: emptyOpen } = materializedPanel(panelSnapshot({ viewId: "empty", threadId: null }));

      await panels(await pluginWithLeaves([pendingLeaf, emptyLeaf])).openThreadInAvailableView("thread-1");

      expect(pendingOpen).not.toHaveBeenCalled();
      expect(emptyOpen).toHaveBeenCalledWith("thread-1", { focus: false });
    },
  );

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("returns from a fork only after source activation succeeds (other panel=%s, success=%s)", async (otherPanel, success) => {
    const origin = leaf();
    const destination = otherPanel ? leaf() : origin;
    origin.view = chatView(CodexChatView, origin);
    if (otherPanel) destination.view = chatView(CodexChatView, destination);
    const originView = origin.view as CodexChatView;
    const targetView = destination.view as CodexChatView;
    let originThread: string | null = null;
    vi.spyOn(originView.surface, "openPanelSnapshot").mockImplementation(() =>
      panelSnapshot({ viewId: "origin", threadId: originThread, hasForkDraft: originThread === null }),
    );
    if (otherPanel)
      vi.spyOn(targetView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "target", threadId: "source" }));
    const pending = deferred<boolean>();
    vi.spyOn(targetView.surface, "activateThread").mockImplementation(async () => {
      const activated = await pending.promise;
      if (activated && !otherPanel) originThread = "source";
      return activated;
    });
    const coordinator = panels(await pluginWithLeaves(otherPanel ? [origin, destination] : [origin]));
    const returning = coordinator.returnFromForkDraft("source", "origin", () => true);
    expect(origin.detach).not.toHaveBeenCalled();
    pending.resolve(success);
    await expect(returning).resolves.toBe(success);
    expect(origin.detach).toHaveBeenCalledTimes(otherPanel && success ? 1 : 0);
  });

  it.each(["queued", "opening"])("does not return a fork panel that changed while %s", async (stage) => {
    const origin = leaf();
    const target = leaf();
    origin.view = chatView(CodexChatView, origin);
    target.view = chatView(CodexChatView, target);
    vi.spyOn((origin.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "origin", threadId: null }),
    );
    vi.spyOn((target.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(
      panelSnapshot({ viewId: "target", threadId: "source" }),
    );
    let current = true;
    const pending = deferred<boolean>();
    const activate = vi.spyOn((target.view as CodexChatView).surface, "activateThread").mockImplementation(async () => {
      if (stage === "queued") return pending.promise;
      current = false;
      return true;
    });
    const coordinator = panels(await pluginWithLeaves([origin, target]));
    const preceding = stage === "queued" ? coordinator.openThreadInAvailableView("source") : Promise.resolve();
    const returning = coordinator.returnFromForkDraft("source", "origin", () => current);
    if (stage === "queued") {
      current = false;
      pending.resolve(true);
    }
    await preceding;
    await expect(returning).resolves.toBe(false);
    expect(activate).toHaveBeenCalledOnce();
    expect(origin.detach).not.toHaveBeenCalled();
  });

  it("uses a switchable origin before another empty panel", async () => {
    const { panelLeaf: originLeaf, activateThread: originOpen } = materializedPanel(
      panelSnapshot({ viewId: "origin", threadId: "source" }),
    );
    const { panelLeaf: emptyLeaf, activateThread: emptyOpen } = materializedPanel(panelSnapshot({ viewId: "empty", threadId: null }));

    await panels(await pluginWithLeaves([originLeaf, emptyLeaf])).openThreadFromPanel("target", "origin", true);

    expect(originOpen).toHaveBeenCalledWith("target", { focus: false });
    expect(emptyOpen).not.toHaveBeenCalled();
  });

  it("opens a restored current panel after reveal materializes it", async () => {
    const restoredLeaf = leaf({ state: { threadId: "restored-thread" } });
    const plugin = await pluginWithLeaves([restoredLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(restoredLeaf);
    const view = chatView(CodexChatView, restoredLeaf);
    const open = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
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
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    const firstFocusThread = vi.spyOn(firstView.surface, "activateThread").mockResolvedValue(true);
    const secondFocusThread = vi.spyOn(secondView.surface, "activateThread").mockResolvedValue(true);
    const firstFocusComposer = vi.spyOn(firstView.surface, "focusComposer");
    const secondFocusComposer = vi.spyOn(secondView.surface, "focusComposer");
    const firstReveal = deferred<void>();
    const secondReveal = deferred<void>();
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
    await secondOpen;
    expect(secondFocusThread).toHaveBeenCalledWith("second", { focus: false });
    expect(secondFocusComposer).toHaveBeenCalledOnce();
    expect(firstFocusThread).not.toHaveBeenCalled();
    expect(firstFocusComposer).not.toHaveBeenCalled();

    firstReveal.resolve();
    await firstOpen;

    expect(firstFocusThread).toHaveBeenCalledWith("first", { focus: false });
    expect(firstFocusComposer).toHaveBeenCalledOnce();
  });

  it.each([false, true])("starts a new chat through the current panel with a competing recent panel=%s", async (hasActivePanel) => {
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const view = panelLeaf.view as CodexChatView;
    const start = vi.spyOn(view.surface, "startNewThread").mockResolvedValue(undefined);
    const focus = vi.spyOn(view.surface, "focusComposer");
    const recentLeaf = leaf();
    recentLeaf.view = chatView(CodexChatView, recentLeaf);
    const recentStart = vi.spyOn((recentLeaf.view as CodexChatView).surface, "startNewThread").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([recentLeaf, panelLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(hasActivePanel ? recentLeaf : panelLeaf);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(hasActivePanel ? view : null);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      expect(start).toHaveBeenCalledWith({ focus: false });
    });

    await panels(plugin).startNewChat();

    expect(start).toHaveBeenCalledWith({ focus: false });
    expect(recentStart).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("lets independent new-panel requests both complete", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstLeaf).mockReturnValueOnce(secondLeaf);
    const firstView = chatView(CodexChatView, firstLeaf);
    const secondView = chatView(CodexChatView, secondLeaf);
    const firstOpen = vi.spyOn(firstView.surface, "activateThread").mockResolvedValue(true);
    const secondOpen = vi.spyOn(secondView.surface, "activateThread").mockResolvedValue(true);
    const firstFocus = vi.spyOn(firstView.surface, "focusComposer");
    const secondFocus = vi.spyOn(secondView.surface, "focusComposer");
    installLeafView(firstLeaf, firstView, leaves);
    installLeafView(secondLeaf, secondView, leaves);
    const coordinator = panels(plugin);

    await Promise.all([coordinator.openThreadInNewView("first"), coordinator.openThreadInNewView("second")]);

    expect(firstOpen).toHaveBeenCalledWith("first", { focus: false });
    expect(secondOpen).toHaveBeenCalledWith("second", { focus: false });
    expect(firstFocus).toHaveBeenCalledOnce();
    expect(secondFocus).toHaveBeenCalledOnce();
  });

  it.each(["persistent", "side-chat"] as const)(
    "opens separate unsaved %s drafts from the same source without claiming its thread",
    async (kind) => {
      const leaves: ReturnType<typeof leaf>[] = [];
      const plugin = await pluginWithLeaves(leaves);
      const firstLeaf = leaf();
      const secondLeaf = leaf();
      const firstView = chatView(CodexChatView, firstLeaf);
      const secondView = chatView(CodexChatView, secondLeaf);
      (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstLeaf).mockReturnValueOnce(secondLeaf);
      installLeafView(firstLeaf, firstView, leaves);
      installLeafView(secondLeaf, secondView, leaves);
      const preparation: ForkDraftPreparation =
        kind === "side-chat"
          ? sideChatDraft("source", "Source")
          : {
              draft: {
                kind: "persistent",
                sourceThreadId: "source",
                boundary: { kind: "through-turn", turnId: "turn" },
              },
              runtime: createChatState().runtime,
              display: { items: [], turnDiffs: new Map() },
            };
      const coordinator = panels(plugin);
      await coordinator.openForkDraft(preparation);
      await coordinator.openForkDraft(preparation);
      expect(coordinator.getOpenPanelSnapshots()).toHaveLength(2);
      for (const view of [firstView, secondView]) {
        expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: true, hasComposerDraft: false });
        expect(view.getState()).toEqual({ version: 1 });
      }
      expect(firstLeaf.detach).not.toHaveBeenCalled();
      expect(secondLeaf.detach).not.toHaveBeenCalled();
    },
  );

  it("settles concurrent panel selections on one thread owner", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const firstView = firstLeaf.view as CodexChatView;
    const secondView = secondLeaf.view as CodexChatView;
    let firstThreadId = "first-source";
    let secondThreadId = "second-source";
    let secondHasDraft = true;
    vi.spyOn(firstView.surface, "openPanelSnapshot").mockImplementation(() => panelSnapshot({ viewId: "first", threadId: firstThreadId }));
    vi.spyOn(secondView.surface, "openPanelSnapshot").mockImplementation(() =>
      panelSnapshot({ viewId: "second", threadId: secondThreadId, hasComposerDraft: secondHasDraft }),
    );
    const firstActivation = deferred<void>();
    const firstOpen = vi.spyOn(firstView.surface, "activateThread").mockImplementation(async (threadId) => {
      if (firstOpen.mock.calls.length === 1) {
        await firstActivation.promise;
        if (threadId) firstThreadId = threadId;
      }
      return true;
    });
    vi.spyOn(secondView.surface, "activateThread").mockImplementation(async (threadId) => {
      if (!threadId) return false;
      secondThreadId = threadId;
      secondHasDraft = false;
      return true;
    });
    const coordinator = panels(await pluginWithLeaves([firstLeaf, secondLeaf]));

    const firstSelection = coordinator.openThreadFromPanel("target", "first", true);
    await vi.waitFor(() => expect(firstOpen).toHaveBeenCalledWith("target", { focus: false }));
    const secondSelection = coordinator.openThreadFromPanel("target", "second", true);

    firstActivation.resolve();
    await Promise.all([firstSelection, secondSelection]);

    expect(coordinator.getOpenPanelSnapshots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ viewId: "first", threadId: "target" }),
        expect.objectContaining({ viewId: "second", threadId: "second-source", hasComposerDraft: true }),
      ]),
    );
    expect(firstLeaf.detach).not.toHaveBeenCalled();
    expect(secondLeaf.detach).not.toHaveBeenCalled();
  });

  it.each(eventOrders("activate", "reveal", "replace"))("focuses only a still-owned panel for $order", async ({ order }) => {
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const view = panelLeaf.view as CodexChatView;
    const replacementView = chatView(CodexChatView, panelLeaf);
    const operation = deferred<boolean>();
    const reveal = deferred<void>();
    const open = vi.spyOn(view.surface, "activateThread").mockReturnValue(operation.promise);
    const oldFocus = vi.spyOn(view.surface, "focusComposer");
    const newFocus = vi.spyOn(replacementView.surface, "focusComposer");
    const leaves = [panelLeaf];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(panelLeaf);
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockReturnValue(reveal.promise);
    const coordinator = panels(plugin);

    const request = coordinator.openThreadInCurrentView("target");
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("target", { focus: false }));
    for (const event of order) {
      if (event === "activate") operation.resolve(true);
      if (event === "reveal") reveal.resolve();
      if (event === "replace") panelLeaf.view = replacementView;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await request;

    expect(oldFocus).toHaveBeenCalledTimes(order.at(-1) === "replace" ? 1 : 0);
    expect(newFocus).not.toHaveBeenCalled();
  });

  it("opens a thread in a new panel through its activation surface", async () => {
    const newLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(newLeaf);
    const view = chatView(CodexChatView, newLeaf);
    newLeaf.setViewState.mockImplementation(async () => {
      newLeaf.view = view;
      leaves.push(newLeaf);
    });
    const open = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    const displaySnapshot = { items: [], turnDiffs: new Map([["turn", "diff"]]) };
    (plugin.app.workspace.revealLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      expect(open).toHaveBeenCalledWith("thread-1", { focus: false, displaySnapshot });
    });

    await panels(plugin).openThreadInNewView("thread-1", displaySnapshot);

    expect(newLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      active: false,
      state: { version: 1 },
    });
    expect(open).toHaveBeenCalledWith("thread-1", { focus: false, displaySnapshot });
  });

  it("reveals a pending side chat immediately without focusing it when creation fails", async () => {
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(sideLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const focus = vi.spyOn(sideView.surface, "focusComposer");
    const pendingOpening = deferred<boolean>();
    vi.spyOn(sideView.surface, "applyForkDraft").mockReturnValue(pendingOpening.promise);
    sideLeaf.setViewState.mockImplementation(async () => {
      sideLeaf.view = sideView;
      leaves.push(sideLeaf);
    });

    const opening = panels(plugin).openForkDraft(sideChatDraft("source", "Source"));
    await vi.waitFor(() => expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(sideLeaf));
    expect(focus).not.toHaveBeenCalled();
    pendingOpening.resolve(false);
    await opening;

    expect(focus).not.toHaveBeenCalled();
  });

  it("opens side chats through the shared draft path", async () => {
    const regularLeaf = leaf();
    const sideLeaf = leaf();
    const leaves = [] as ReturnType<typeof leaf>[];
    const plugin = await pluginWithLeaves(leaves);
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValueOnce(regularLeaf).mockReturnValueOnce(sideLeaf);
    const regularView = chatView(CodexChatView, regularLeaf);
    const sideView = chatView(CodexChatView, sideLeaf);
    const connect = vi.spyOn(regularView.surface, "connect").mockResolvedValue(undefined);
    const applyDraft = vi.spyOn(sideView.surface, "applyForkDraft").mockResolvedValue(true);
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
    await coordinator.openForkDraft(sideChatDraft("source", "Source thread"), "Explain this briefly");

    expect(connect).toHaveBeenCalledOnce();
    expect(sideLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      active: false,
      state: { version: 1 },
    });
    expect(applyDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draft: { kind: "side-chat", sourceThreadId: "source", sourceThreadTitle: "Source thread" } }),
      "Explain this briefly",
    );
  });
});

function panels(plugin: CodexPanelPlugin) {
  const lifetime = new AbortController();
  const coordinator = new WorkspacePanelCoordinator({
    app: plugin.app,
    refreshThreadsViewLiveState: vi.fn(),
    workspaceSignal: () => lifetime.signal,
  });
  return Object.assign(coordinator, coordinator.forRuntime(lifetime.signal));
}

function installLeafView(target: ReturnType<typeof leaf>, view: CodexChatView, leaves: ReturnType<typeof leaf>[]): void {
  target.setViewState.mockImplementation(async () => {
    target.view = view;
    leaves.push(target);
  });
}

async function sidePanelFixture() {
  const leaves = [] as ReturnType<typeof leaf>[];
  const plugin = await pluginWithLeaves(leaves);
  const panelLeaf = leaf();
  const view = chatView(CodexChatView, panelLeaf);
  panelLeaf.view = view;
  const connect = vi.spyOn(view.surface, "connect").mockResolvedValue(undefined);
  const focus = vi.spyOn(view.surface, "focusComposer");
  (plugin.app.workspace.ensureSideLeaf as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    leaves.push(panelLeaf);
    return panelLeaf;
  });
  return { leaves, plugin, view, connect, focus };
}

function materializedPanel(snapshot: ReturnType<typeof panelSnapshot>) {
  const panelLeaf = leaf();
  const view = chatView(CodexChatView, panelLeaf);
  panelLeaf.view = view;
  vi.spyOn(view.surface, "openPanelSnapshot").mockReturnValue(snapshot);
  const activateThread = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
  return { panelLeaf, activateThread };
}
