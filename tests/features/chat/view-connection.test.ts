// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
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
    expect(client.resumeThread).not.toHaveBeenCalled();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await vi.advanceTimersByTimeAsync(1_500);

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
    resumeThread: vi.fn().mockResolvedValue(resumedThread("thread-1")),
    threadTurnsList: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    startTurn: vi.fn().mockResolvedValue({ turn: { id: "turn-1" } }),
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

async function chatView(options: { activeLeafChangeListeners?: ((leaf: unknown) => void)[]; requestSaveLayout?: () => void } = {}) {
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
    {
      settings: {
        ...DEFAULT_SETTINGS,
        codexPath: "codex",
        sendShortcut: "enter",
      },
      vaultPath: "/vault",
      openThreadInNewView: vi.fn(),
      openTurnDiff: vi.fn(),
      refreshOpenThreadLists: vi.fn(),
    },
  );
}
