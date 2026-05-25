// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { CodexChatView } from "../src/features/chat/view";
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
      busy: false,
      activeTurnId: null,
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
      busy: false,
      activeTurnId: null,
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
      busy: false,
      activeTurnId: null,
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
    const openThread = vi.spyOn(view, "openThread").mockResolvedValue(undefined);

    await plugin.openThreadInNewView("thread-1");

    expect(connect).not.toHaveBeenCalled();
    expect(openThread).toHaveBeenCalledWith("thread-1");
  });

  it("refreshes open thread lists after archive lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshOpenThreadLists = vi.spyOn(plugin, "refreshOpenThreadLists").mockImplementation(() => undefined);

    plugin.notifyThreadArchived("thread-1");

    expect(refreshOpenThreadLists).toHaveBeenCalledOnce();
  });

  it("refreshes open thread lists after rename lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshOpenThreadLists = vi.spyOn(plugin, "refreshOpenThreadLists").mockImplementation(() => undefined);

    plugin.notifyThreadRenamed("thread-1", "Renamed thread");

    expect(refreshOpenThreadLists).toHaveBeenCalledOnce();
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
    setViewState: vi.fn().mockResolvedValue(undefined),
    loadIfDeferred: vi.fn().mockResolvedValue(undefined),
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
          on: vi.fn(() => ({})),
          openLinkText: vi.fn(),
          requestSaveLayout: vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
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
      openTurnDiff: vi.fn(),
      notifyThreadArchived: vi.fn(),
      notifyThreadRenamed: vi.fn(),
      refreshOpenThreadLists: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
      refreshThreadsViewThreadList: vi.fn(),
    },
  );
}
