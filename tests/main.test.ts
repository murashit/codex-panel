// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRuntimeView } from "../src/features/chat/host/contracts";
import { CodexChatView } from "../src/features/chat/host/view.obsidian";
import { waitForAsyncWork } from "./support/async";
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

  it("loads restored Codex panel leaves after startup without blocking onload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    await plugin.onload();

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledOnce();
  });

  it("discards turn diff leaves on plugin load because their payloads do not survive reloads", async () => {
    const turnDiffLeaf = leaf();
    const plugin = await pluginWithLeaves([], { turnDiffLeaves: [turnDiffLeaf] });

    await plugin.onload();

    expect(turnDiffLeaf.detach).toHaveBeenCalledOnce();
    expect(turnDiffLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });

  it("cancels pending workspace reconciliation on unload", async () => {
    vi.useFakeTimers();
    const panelLeaf = leaf();
    const plugin = await pluginWithLeaves([panelLeaf]);

    await plugin.onload();
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(0);

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
    const hydrate = vi.spyOn((panelLeaf.view as CodexChatView).surface, "activateThread").mockResolvedValue(undefined);
    const handler = activeLeafHandlers.at(0);
    if (!handler) throw new Error("Expected active leaf handler to be registered.");
    handler(panelLeaf);

    await waitForAsyncWork(() => {
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });

  it("loads and hydrates the startup foreground panel", async () => {
    vi.useFakeTimers();
    const activeLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const view = chatView(CodexChatView, activeLeaf);
    activeLeaf.loadIfDeferred.mockImplementation(async () => {
      activeLeaf.view = view;
    });
    const plugin = await pluginWithLeaves([activeLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(activeLeaf);

    await plugin.onload();
    const hydrate = vi.spyOn(view.surface, "activateThread").mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(0);

    await waitForAsyncWork(() => {
      expect(activeLeaf.loadIfDeferred).toHaveBeenCalledOnce();
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });

  it("repairs duplicate reattached thread panels before hydrating the owner", async () => {
    vi.useFakeTimers();
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
      hasComposerDraft: false,
      connected: false,
    });
    vi.spyOn(duplicateView.surface, "openPanelSnapshot").mockReturnValue({
      viewId: "duplicate",
      threadId: "thread-1",
      turnBusy: false,
      pending: false,
      hasComposerDraft: false,
      connected: false,
    });
    const firstHydrate = vi.spyOn(firstView.surface, "activateThread").mockResolvedValue(undefined);
    const duplicateHydrate = vi.spyOn(duplicateView.surface, "activateThread").mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(0);

    await waitForAsyncWork(() => {
      expect(firstHydrate).toHaveBeenCalledOnce();
      expect(duplicateLeaf.detach).toHaveBeenCalledOnce();
      expect(duplicateHydrate).not.toHaveBeenCalled();
    });
  });
});
