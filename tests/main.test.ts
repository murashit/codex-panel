// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { CodexChatView } from "../src/features/chat/view";
import type { Thread } from "../src/generated/app-server/v2/Thread";
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
    const openThread = vi.spyOn(view, "openThread").mockResolvedValue(undefined);

    await plugin.openNewPanel();

    expect(connect).toHaveBeenCalledOnce();
    expect(openThread).not.toHaveBeenCalled();
  });

  it("refreshes shared thread lists after archive lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi.spyOn(plugin, "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    plugin.notifyThreadArchived("thread-1");

    expect(refreshSharedThreadList).toHaveBeenCalledOnce();
  });

  it("refreshes shared thread lists after rename lifecycle notifications", async () => {
    const plugin = await pluginWithLeaves([]);
    const refreshSharedThreadList = vi.spyOn(plugin, "refreshSharedThreadListFromOpenSurface").mockImplementation(() => undefined);

    plugin.notifyThreadRenamed("thread-1", "Renamed thread");

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

    const first = plugin.refreshThreadList(fetchThreads);
    const second = plugin.refreshThreadList(secondFetch);

    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(secondFetch).not.toHaveBeenCalled();
    resolveThreads([thread("first")]);

    await expect(first).resolves.toEqual([thread("first")]);
    await expect(second).resolves.toEqual([thread("first")]);
    expect(plugin.cachedThreadList()).toEqual([thread("first")]);
  });

  it("keeps the previous shared thread list when refresh fails", async () => {
    const plugin = await pluginWithLeaves([]);
    await plugin.refreshThreadList(() => Promise.resolve([thread("cached")]));

    await expect(plugin.refreshThreadList(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    expect(plugin.cachedThreadList()).toEqual([thread("cached")]);
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

    plugin.refreshSharedThreadListFromOpenSurface();

    expect(disconnectedRefresh).not.toHaveBeenCalled();
    expect(connectedRefresh).toHaveBeenCalledOnce();
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
      focusThreadInOpenView: vi.fn(),
      openTurnDiff: vi.fn(),
      notifyThreadArchived: vi.fn(),
      notifyThreadRenamed: vi.fn(),
      refreshSharedThreadListFromOpenSurface: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
      refreshThreadList: vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>),
      cachedThreadList: vi.fn(() => null),
      publishSessionMetadata: vi.fn(),
      cachedSessionMetadata: vi.fn(() => null),
    },
  );
}

function thread(id: string): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    preview: id,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  } as Thread;
}

function panelSnapshot(
  overrides: Partial<ReturnType<CodexChatView["openPanelSnapshot"]>> = {},
): ReturnType<CodexChatView["openPanelSnapshot"]> {
  return {
    viewId: "view",
    threadId: "thread",
    busy: false,
    activeTurnId: null,
    pendingApprovals: 0,
    pendingUserInputs: 0,
    hasComposerDraft: false,
    connected: true,
    ...overrides,
  };
}
