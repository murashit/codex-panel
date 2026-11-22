// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRuntimeView } from "../src/features/chat/host/contracts";
import { CodexChatView } from "../src/features/chat/host/view.obsidian";
import { deferred, waitForAsyncWork } from "./support/async";
import { installObsidianDomShims } from "./support/dom";
import { chatView, leaf, pluginWithLeaves, type TestLeaf } from "./support/plugin-fixtures";

installObsidianDomShims();

describe("CodexPanelPlugin lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens the panel through its registered command and ribbon action", async () => {
    const plugin = await pluginWithLeaves([]);
    const commands = vi.spyOn(plugin, "addCommand");
    const ribbons = vi.spyOn(plugin, "addRibbonIcon");
    try {
      await plugin.onload();
      const activate = vi.spyOn(plugin.runtime, "activatePanel").mockResolvedValue(null);
      const command = commands.mock.calls.map(([entry]) => entry).find((entry) => entry.id === "open-panel");
      expect(command?.callback).toBeTypeOf("function");
      command?.callback?.();
      await Promise.resolve();
      expect(activate).toHaveBeenCalledOnce();

      const ribbon = ribbons.mock.calls.find(([, title]) => title === "Open panel");
      expect(ribbon?.[2]).toBeTypeOf("function");
      ribbon?.[2](new MouseEvent("click"));
      await Promise.resolve();
      expect(activate).toHaveBeenCalledTimes(2);
    } finally {
      plugin.onunload();
    }
  });

  it("ignores a settings read that completes after plugin unload", async () => {
    const plugin = await pluginWithLeaves([]);
    const read = deferred<unknown>();
    vi.spyOn(plugin, "loadData").mockReturnValue(read.promise);
    const save = vi.spyOn(plugin, "saveSettings");
    const views = vi.spyOn(plugin, "registerView");
    const loading = plugin.onload();
    plugin.onunload();
    read.resolve({ showToolbar: false });
    await loading;
    expect(plugin.settings.showToolbar).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(views).not.toHaveBeenCalled();
  });

  it("loads restored Codex panel leaves after startup without blocking onload", async () => {
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    vi.spyOn(plugin, "loadData").mockResolvedValue({ showToolbar: false, sendShortcut: "mod-enter" });

    await plugin.onload();

    expect(plugin.runtime.settingTabHost().settings).toMatchObject({ showToolbar: false, sendShortcut: "mod-enter" });
    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("repairs background layout changes without loading restored leaves", async () => {
    const leaves = [leaf({ state: { threadId: "same" } })];
    const plugin = await pluginWithLeaves(leaves);
    const handlers: (() => void)[] = [];
    (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation((name: string, handler: () => void) => {
      if (name === "layout-change") handlers.push(handler);
      return {};
    });
    await plugin.onload();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    leaves[0]?.loadIfDeferred.mockClear();
    const duplicate = leaf({ state: { threadId: "same" } });
    leaves.push(duplicate);
    for (const handler of handlers) handler();
    expect(duplicate.setViewState).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(duplicate.setViewState).toHaveBeenCalledOnce();
    for (const target of leaves) expect(target.loadIfDeferred).not.toHaveBeenCalled();
    plugin.onunload();
  });

  it("does not revive reconciliation when layout becomes ready after unload", async () => {
    const panel = leaf();
    const plugin = await pluginWithLeaves([panel]);
    let ready: (() => void) | undefined;
    (plugin.app.workspace.onLayoutReady as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      ready = callback;
    });
    await plugin.onload();
    plugin.onunload();
    ready?.();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(panel.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("discards turn diff leaves on plugin load because their payloads do not survive reloads", async () => {
    const turnDiffLeaf = leaf();
    const plugin = await pluginWithLeaves([], { turnDiffLeaves: [turnDiffLeaf] });

    await plugin.onload();

    expect(turnDiffLeaf.detach).toHaveBeenCalledOnce();
    expect(turnDiffLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("cancels pending workspace reconciliation on unload", async () => {
    const panelLeaf = leaf();
    const plugin = await pluginWithLeaves([panelLeaf]);

    await plugin.onload();
    plugin.onunload();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(panelLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("disposes execution-runtime views on unload", async () => {
    const view = {
      attachRuntime: vi.fn(),
      detachRuntime: vi.fn().mockResolvedValue(undefined),
    };
    const viewLeaf = leaf();
    const runtimeView = Object.assign(Object.create(CodexChatView.prototype), view) as ChatRuntimeView;
    viewLeaf.view = runtimeView;
    const plugin = await pluginWithLeaves([viewLeaf]);
    plugin.runtime.attachChatView(runtimeView);

    plugin.onunload();

    expect(view.detachRuntime).toHaveBeenCalledOnce();
  });

  it("hydrates a restored panel when Obsidian activates its leaf", async () => {
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const activeLeafHandlers: ((leaf: TestLeaf | null) => void)[] = [];
    const plugin = await pluginWithLeaves([panelLeaf]);
    (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation((name: string, handler: (leaf: TestLeaf | null) => void) => {
      if (name === "active-leaf-change") activeLeafHandlers.push(handler);
      return {};
    });

    await plugin.onload();
    const hydrate = vi.spyOn((panelLeaf.view as CodexChatView).surface, "activateThread").mockResolvedValue(true);
    const handler = activeLeafHandlers.at(0);
    if (!handler) throw new Error("Expected active leaf handler to be registered.");
    handler(panelLeaf);

    await waitForAsyncWork(() => {
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });

  it("loads and hydrates the startup foreground panel", async () => {
    const activeLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const view = chatView(CodexChatView, activeLeaf);
    activeLeaf.loadIfDeferred.mockImplementation(async () => {
      activeLeaf.view = view;
    });
    const plugin = await pluginWithLeaves([activeLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(activeLeaf);

    await plugin.onload();
    const hydrate = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    await waitForAsyncWork(() => {
      expect(activeLeaf.loadIfDeferred).toHaveBeenCalledOnce();
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });

  it("repairs duplicate reattached thread panels before hydrating the owner", async () => {
    const firstLeaf = leaf();
    const duplicateLeaf = leaf();
    const firstView = chatView(CodexChatView, firstLeaf);
    const duplicateView = chatView(CodexChatView, duplicateLeaf);
    firstLeaf.view = firstView;
    duplicateLeaf.view = duplicateView;
    const plugin = await pluginWithLeaves([firstLeaf, duplicateLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(firstLeaf);

    await plugin.onload();
    vi.spyOn(firstView.surface, "openPanelSnapshot").mockReturnValue({
      viewId: "first",
      threadId: "thread-1",
      turnBusy: false,
      pending: false,
      unread: false,
      loadingThread: false,
      hasComposerDraft: false,
      hasForkDraft: false,
      connected: false,
    });
    vi.spyOn(duplicateView.surface, "openPanelSnapshot").mockReturnValue({
      viewId: "duplicate",
      threadId: "thread-1",
      turnBusy: false,
      pending: false,
      unread: false,
      loadingThread: false,
      hasComposerDraft: false,
      hasForkDraft: false,
      connected: false,
    });
    const firstHydrate = vi.spyOn(firstView.surface, "activateThread").mockResolvedValue(true);
    const duplicateHydrate = vi.spyOn(duplicateView.surface, "activateThread").mockResolvedValue(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    await waitForAsyncWork(() => {
      expect(firstHydrate).toHaveBeenCalledOnce();
      expect(duplicateLeaf.detach).toHaveBeenCalledOnce();
      expect(duplicateHydrate).not.toHaveBeenCalled();
    });
  });
});
