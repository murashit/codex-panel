// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { CodexChatHost } from "../../../src/features/chat/view";
import { notices } from "../../mocks/obsidian";
import { installObsidianDomShims } from "./ui/dom-test-helpers";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connectCalls: 0,
    connected: false,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connectCalls = 0;
      state.connected = false;
    },
  };
});

vi.mock("../../../src/app-server/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    connect(): Promise<unknown> {
      connectionMock.state.connectCalls += 1;
      connectionMock.state.connected = true;
      return Promise.resolve({
        userAgent: "codex-test",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      });
    }

    currentClient(): unknown {
      return connectionMock.state.connected ? connectionMock.state.client : null;
    }

    isConnected(): boolean {
      return connectionMock.state.connected;
    }

    reconnect(): void {
      this.disconnect();
    }

    disconnect(): void {
      connectionMock.state.connected = false;
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

installObsidianDomShims();

describe("CodexChatView connection lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await Promise.all([view.connect(), view.connect()]);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.listSkills).toHaveBeenCalledTimes(1);
    expect(client.readAccountRateLimits).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledTimes(1);
  });

  it("ignores stale connection work after the view closes", async () => {
    let resolveConfig!: (value: unknown) => void;
    const client = connectedClient({
      readEffectiveConfig: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveConfig = resolve;
          }),
      ),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const connecting = view.connect();
    await Promise.resolve();
    await view.onClose();
    resolveConfig({});
    await connecting;

    expect(notices).toEqual([]);
    expect(client.listThreads).not.toHaveBeenCalled();
  });
  it("restores the active thread from workspace state and hydrates it after a delay", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      resumeThread: vi.fn().mockResolvedValue(resumedThread("thread-1")),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(connectionMock.state.connectCalls).toBe(0);
    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(view.containerEl.textContent).toContain("Thread restored. Send a message to resume it.");

    await vi.advanceTimersByTimeAsync(1_500);

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("hydrates a restored thread when workspace state arrives after open", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(connectionMock.state.connectCalls).toBe(0);
    expect(client.resumeThread).not.toHaveBeenCalled();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("hydrates a focused restored thread immediately", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(client.resumeThread).not.toHaveBeenCalled();
    await view.focusThread("thread-1");

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("resumes a restored thread before sending the first message", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    view.setComposerText("hello");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.startTurn).toHaveBeenCalledWith("thread-1", "/vault", [{ type: "text", text: "hello", text_elements: [] }]);
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
  });

  it("requests a workspace layout save after resuming a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.openThread("thread-1");

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(requestSaveLayout).toHaveBeenCalledTimes(1);
  });

  it("resets to an unstarted empty chat without starting a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.openThread("thread-1");
    await view.startNewThread();

    expect(client.startThread).not.toHaveBeenCalled();
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.openPanelSnapshot()).toMatchObject({ threadId: null, busy: false, activeTurnId: null, hasComposerDraft: false });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("starts a thread only when /new includes a message to send", async () => {
    const client = connectedClient({
      startThread: vi.fn().mockResolvedValue(startedThread("thread-new")),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.onOpen();
    await view.connect();
    view.setComposerText("/new hello");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

    expect(client.startThread).toHaveBeenCalledOnce();
    expect(client.startTurn).toHaveBeenCalledWith("thread-new", "/vault", [{ type: "text", text: "hello", text_elements: [] }]);
  });

  it("routes slash resume through the shared panel selection path", async () => {
    const openThreadInAvailableView = vi.fn().mockResolvedValue(undefined);
    const host = chatHost({
      openThreadInAvailableView,
    });
    connectionMock.state.client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
    });
    const view = await chatView({ host });

    await view.connect();
    view.setComposerText("/resume thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

    expect(openThreadInAvailableView).toHaveBeenCalledWith("thread-1");
    expect(connectionMock.state.client["resumeThread"]).not.toHaveBeenCalled();
  });

  it("keeps resumed messages pinned to bottom after slash resume in the same empty panel", async () => {
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView({
      host: chatHost({
        openThreadInAvailableView: async (threadId) => {
          await view.openThread(threadId);
        },
      }),
    });

    await view.onOpen();
    await view.connect();
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 0;

    view.setComposerText("/resume thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();
    await new Promise<void>((resolve) => {
      messages.win.requestAnimationFrame(() => {
        resolve();
      });
    });

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(1000);
  });

  it("routes slash archive through shared panel notifications", async () => {
    const notifyThreadArchived = vi.fn();
    const host = chatHost({
      notifyThreadArchived,
    });
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
    });
    connectionMock.state.client = client;
    const view = await chatView({ host });

    await view.connect();
    view.setComposerText("/archive thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

    expect(client.archiveThread).toHaveBeenCalledWith("thread-1");
    expect(notifyThreadArchived).toHaveBeenCalledWith("thread-1");
  });

  it("clears the active thread when another view archives it", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.openThread("thread-1");
    view.notifyThreadArchived("thread-1");

    expect(view.getState()).toEqual({ version: 1 });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("updates restored panel title from shared rename notifications", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Before rename" }, {} as never);
    view.notifyThreadRenamed("thread-1", "After rename");

    expect(view.getDisplayText()).toBe("Codex: After rename");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "After rename" });
  });

  it("scrolls resumed messages to the bottom after history hydrates", async () => {
    const client = connectedClient({
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 0;

    await view.openThread("thread-1");
    await new Promise<void>((resolve) => {
      messages.win.requestAnimationFrame(() => {
        resolve();
      });
    });

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(1000);
  });

  it("renders resumed thread metadata before history hydration completes", async () => {
    const history = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      threadTurnsList: vi.fn(() => history.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const opening = view.openThread("thread-1");
    await vi.waitFor(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
    });

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).toContain("Loading thread...");

    history.resolve({ data: [], nextCursor: null });
    await opening;
  });

  it("ignores stale resume results when another thread is opened first", async () => {
    const firstResume = deferred<ReturnType<typeof resumedThread>>();
    const secondResume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      resumeThread: vi.fn((threadId: string) => (threadId === "thread-1" ? firstResume.promise : secondResume.promise)),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstOpen = view.openThread("thread-1");
    await vi.waitFor(() => {
      expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    });
    const secondOpen = view.openThread("thread-2");
    await vi.waitFor(() => {
      expect(client.resumeThread).toHaveBeenCalledWith("thread-2", "/vault");
    });

    secondResume.resolve(resumedThread("thread-2"));
    await secondOpen;
    firstResume.resolve(resumedThread("thread-1"));
    await firstOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expect(client.threadTurnsList).toHaveBeenCalledTimes(1);
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-2", null, 20);
  });

  it("invalidates stale history hydration when a second resume starts", async () => {
    const firstHistory = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      resumeThread: vi.fn((threadId: string) => Promise.resolve(resumedThread(threadId))),
      threadTurnsList: vi.fn((threadId: string) =>
        threadId === "thread-1" ? firstHistory.promise : Promise.resolve({ data: [], nextCursor: null }),
      ),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstOpen = view.openThread("thread-1");
    await vi.waitFor(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
    });
    const secondOpen = view.openThread("thread-2");
    await vi.waitFor(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-2", null, 20);
    });

    firstHistory.resolve({ data: [turnWithUserMessage("first prompt")], nextCursor: null });
    await firstOpen;
    await secondOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).not.toContain("first prompt");
  });

  it("scrolls restored messages to the bottom when the panel is focused", async () => {
    const activeLeafChangeListeners: ((leaf: unknown) => void)[] = [];
    const view = await chatView({ activeLeafChangeListeners });

    await view.onOpen();
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 0;

    activeLeafChangeListeners.forEach((listener) => {
      listener(view.leaf);
    });
    await new Promise<void>((resolve) => {
      messages.win.requestAnimationFrame(() => {
        resolve();
      });
    });

    expect(messages.scrollTop).toBe(1000);
  });
});

function connectedClient(overrides: Partial<ReturnType<typeof baseClient>> = {}): ReturnType<typeof baseClient> {
  return {
    ...baseClient(),
    ...overrides,
  };
}

function baseClient() {
  return {
    readEffectiveConfig: vi.fn().mockResolvedValue({}),
    listModels: vi.fn().mockResolvedValue({ data: [] }),
    listSkills: vi.fn().mockResolvedValue({ data: [] }),
    readAccountRateLimits: vi.fn().mockResolvedValue({ rateLimits: null }),
    listThreads: vi.fn().mockResolvedValue({ data: [] }),
    startThread: vi.fn().mockResolvedValue(startedThread("thread-new")),
    resumeThread: vi.fn().mockResolvedValue(resumedThread("thread-1")),
    threadTurnsList: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    startTurn: vi.fn().mockResolvedValue({ turn: { id: "turn-1" } }),
    archiveThread: vi.fn().mockResolvedValue({}),
  };
}

function startedThread(threadId: string) {
  return {
    thread: {
      id: threadId,
      name: null,
      preview: "",
      cwd: "/vault",
      cliVersion: "0.0.0",
    },
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

function resumedThread(threadId: string) {
  return {
    thread: {
      id: threadId,
      name: "Restored thread",
      preview: "Restored thread",
      cwd: "/vault",
      cliVersion: "0.0.0",
    },
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

function threadFixture(threadId: string) {
  return {
    id: threadId,
    sessionId: "session",
    forkedFromId: null,
    preview: "Restored thread",
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
  };
}

function turnWithUserMessage(text: string) {
  return {
    id: "turn-1",
    startedAt: 1,
    completedAt: 2,
    items: [{ type: "userMessage", id: "user-1", content: [{ type: "text", text, text_elements: [] }] }],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function chatHost(overrides: Partial<CodexChatHost> = {}): CodexChatHost {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      codexPath: "codex",
      sendShortcut: "enter",
    },
    vaultPath: "/vault",
    openThreadInNewView: vi.fn(),
    openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    openTurnDiff: vi.fn(),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    refreshOpenThreadLists: vi.fn(),
    refreshThreadsViewLiveState: vi.fn(),
    refreshThreadsViewThreadList: vi.fn(),
    ...overrides,
  };
}

async function chatView(
  options: { activeLeafChangeListeners?: ((leaf: unknown) => void)[]; host?: CodexChatHost; requestSaveLayout?: () => void } = {},
) {
  const host = options.host ?? chatHost();
  const { CodexChatView } = await import("../../../src/features/chat/view");
  const containerEl = document.createElement("div");
  containerEl.createDiv();
  containerEl.createDiv();
  return new CodexChatView(
    {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          on: vi.fn((eventName: string, callback: (leaf: unknown) => void) => {
            if (eventName === "active-leaf-change") options.activeLeafChangeListeners?.push(callback);
            return {};
          }),
          openLinkText: vi.fn(),
          requestSaveLayout: options.requestSaveLayout ?? vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
          getMarkdownFiles: vi.fn(() => []),
        },
      },
      containerEl,
    } as never,
    host,
  );
}
