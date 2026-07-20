// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexChatView } from "../src/features/chat/host/view.obsidian";
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
    const plugin = await pluginWithLeaves([]);
    const view = {
      attachRuntime: vi.fn(),
      activateRuntime: vi.fn(),
      detachRuntime: vi.fn(),
    };
    plugin.runtime.attachChatView(view);

    plugin.onunload();

    expect(view.detachRuntime).toHaveBeenCalledOnce();
  });

  it("hydrates a restored panel when Obsidian activates its leaf", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const panelLeaf = leaf();
    panelLeaf.view = chatView(CodexChatView, panelLeaf);
    const hydrate = vi.spyOn((panelLeaf.view as CodexChatView).surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    const activeLeafHandlers: ((leaf: TestLeaf | null) => void)[] = [];
    const plugin = await pluginWithLeaves([panelLeaf]);
    (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mockImplementation((name: string, handler: (leaf: TestLeaf | null) => void) => {
      if (name === "active-leaf-change") activeLeafHandlers.push(handler);
      return {};
    });

    await plugin.onload();
    const handler = activeLeafHandlers.at(0);
    if (!handler) throw new Error("Expected active leaf handler to be registered.");
    handler(panelLeaf);

    await waitForAsyncWork(() => {
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });

  it("loads and hydrates the startup foreground panel", async () => {
    vi.useFakeTimers();
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const activeLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored thread" } });
    const view = chatView(CodexChatView, activeLeaf);
    const hydrate = vi.spyOn(view.surface, "hydrateRestoredThread").mockResolvedValue(undefined);
    activeLeaf.loadIfDeferred.mockImplementation(async () => {
      activeLeaf.view = view;
    });
    const plugin = await pluginWithLeaves([activeLeaf]);
    (plugin.app.workspace.getMostRecentLeaf as ReturnType<typeof vi.fn>).mockReturnValue(activeLeaf);

    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    await waitForAsyncWork(() => {
      expect(activeLeaf.loadIfDeferred).toHaveBeenCalledOnce();
      expect(hydrate).toHaveBeenCalledOnce();
    });
  });
});
