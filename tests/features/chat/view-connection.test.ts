// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { CodexChatHost } from "../../../src/features/chat/application/ports/chat-host";
import { createServerDiagnostics } from "../../../src/domain/server/diagnostics";
import type { Thread } from "../../../src/domain/threads/model";
import { emptyRuntimeConfigSnapshot } from "../../../src/app-server/protocol/runtime-config";
import type { ThreadRecord } from "../../../src/app-server/protocol/thread";
import type { ServerNotification } from "../../../src/app-server/connection/rpc-messages";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { installObsidianDomShims } from "../../support/dom";

const ESTIMATED_MESSAGE_BLOCK_HEIGHT = 96;

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connectCalls: 0,
    connected: false,
    onNotification: null as ((notification: ServerNotification) => void) | null,
    onExit: null as (() => void) | null,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connectCalls = 0;
      state.connected = false;
      state.onNotification = null;
      state.onExit = null;
    },
  };
});

vi.mock("../../../src/app-server/connection/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    private handlers: {
      onNotification: (notification: ServerNotification) => void;
      onServerRequest: (request: unknown) => void;
      onLog: (message: string) => void;
      onExit: () => void;
    } | null;

    constructor(_codexPath: () => string, _cwd: string) {
      this.handlers = null;
    }

    connect(handlers: {
      onNotification: (notification: ServerNotification) => void;
      onServerRequest: (request: unknown) => void;
      onLog: (message: string) => void;
      onExit: () => void;
    }): Promise<unknown> {
      this.handlers = handlers;
      this.publishHandlers(handlers);
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

    exit(): void {
      connectionMock.state.connected = false;
      this.handlers?.onExit();
    }

    private publishHandlers(handlers: NonNullable<ConnectionManager["handlers"]>): void {
      connectionMock.state.onNotification = handlers.onNotification;
      connectionMock.state.onExit = handlers.onExit;
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

installObsidianDomShims();

describe("CodexChatView connection lifecycle", () => {
  let restoreDefaultMessageViewportMetrics: (() => void) | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
    restoreDefaultMessageViewportMetrics = mockMessageViewportOffsetMetrics({ clientHeight: 320, clientWidth: 240 });
  });

  afterEach(() => {
    restoreDefaultMessageViewportMetrics?.();
    restoreDefaultMessageViewportMetrics = null;
    document.body.replaceChildren();
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await Promise.all([view.surface.connect(), view.surface.connect()]);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.listSkills).toHaveBeenCalledTimes(1);
    expect(client.readAccountRateLimits).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledTimes(1);
  });

  it("keeps connect calls joined while metadata is still loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      readEffectiveConfig: vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstConnect = view.surface.connect();
    await waitForAsyncWork(() => {
      expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    });

    let secondResolved = false;
    const secondConnect = view.surface.connect().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();

    expect(connectionMock.state.connected).toBe(true);
    expect(secondResolved).toBe(false);

    config.resolve({});
    await Promise.all([firstConnect, secondConnect]);

    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledOnce();
  });

  it("refreshes shared thread lists after connecting", async () => {
    const refreshThreads = vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>);
    const threads = [threadFixture("thread-1")];
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: threads }),
    });
    connectionMock.state.client = client;
    const view = await chatView({
      host: chatHost({ refreshThreads }),
    });

    await view.onOpen();
    await view.surface.connect();

    expect(refreshThreads).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledWith("/vault", { archived: false, cursor: null, limit: 100 });
    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Restored thread");
    });
  });

  it("publishes app-server metadata after connecting", async () => {
    const publishAppServerMetadata = vi.fn();
    connectionMock.state.client = connectedClient();
    const view = await chatView({
      host: chatHost({ publishAppServerMetadata }),
    });

    await view.surface.connect();

    expect(publishAppServerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeConfig: expect.any(Object),
        availableModels: [],
        availableSkills: [],
      }),
    );
  });

  it("renders the chat shell on the view content root", async () => {
    const view = await chatView();
    const siblingRoots = Array.from(view.containerEl.children).filter((child) => child !== view.contentEl);

    await view.onOpen();

    const root = view.contentEl;
    expect(root.classList.contains("codex-panel")).toBe(true);
    expect(root.querySelector(":scope > .codex-panel__toolbar")).not.toBeNull();
    expect(root.querySelector(":scope > .codex-panel__body .codex-panel__region--message-stream")).not.toBeNull();
    expect(root.querySelector(":scope > .codex-panel__body .codex-panel__region--composer")).not.toBeNull();
    expect(siblingRoots.every((sibling) => !sibling.classList.contains("codex-panel") && sibling.childElementCount === 0)).toBe(true);
  });

  it("starts an empty thread when saving a toolbar goal from a blank panel", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      setThreadGoal: vi.fn().mockResolvedValue({
        goal: {
          threadId: "thread-new",
          objective: "Ship the feature",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    });
    connectionMock.state.client = client;
    const view = await chatView();
    await view.onOpen();

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Show chat actions"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Set goal...");
    });
    [...view.containerEl.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")]
      .find((item) => item.textContent === "Set goal...")
      ?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__goal-objective-input")).not.toBeNull();
    });
    const input = requiredTextArea(view.containerEl, ".codex-panel__goal-objective-input");
    input.value = "Ship the feature";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForAsyncWork(() => {
      const save = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save goal"]');
      expect(save?.disabled).toBe(false);
    });
    const save = requiredButton(view.containerEl, '[aria-label="Save goal"]');
    save.click();

    await waitForAsyncWork(() => {
      expect(client.startThread).toHaveBeenCalledWith({ cwd: "/vault", serviceTier: undefined });
      expect(client.setThreadGoal).toHaveBeenCalledWith("thread-new", {
        objective: "Ship the feature",
        status: "active",
        tokenBudget: null,
      });
    });
    await waitForAsyncWork(() => {
      expect(client.injectThreadItems).toHaveBeenCalledWith("thread-new", [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Ship the feature" }],
        },
      ]);
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-new" });
    expect(view.containerEl.textContent).toContain("Ship the feature");
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

    const connecting = view.surface.connect();
    await Promise.resolve();
    await view.onClose();
    resolveConfig({});
    await connecting;

    expect(notices).toEqual([]);
    expect(client.listThreads).not.toHaveBeenCalled();
  });

  it("ignores stale connection work after the app-server exits during metadata loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      readEffectiveConfig: vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const connecting = view.surface.connect();
    await waitForAsyncWork(() => {
      expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    });
    connectionMock.state.connected = false;
    connectionMock.state.onExit?.();

    config.resolve({});
    await connecting;

    expect(client.listThreads).not.toHaveBeenCalled();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: false });
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
    expect(view.containerEl.textContent).not.toContain("Thread restored. Send a message to resume it.");

    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledOnce();
    expect(client.resumeThread).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("formats the panel title from listed thread metadata", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-named" }, {} as never);
    view.surface.applyThreadListSnapshot([panelThread({ id: "thread-named", name: "作業メモ" })]);
    expect(view.getDisplayText()).toBe("Codex: 作業メモ");

    view.surface.applyThreadListSnapshot([panelThread({ id: "thread-named", name: null, preview: "初回依頼" })]);
    expect(view.getDisplayText()).toBe("Codex: 初回依頼");

    await view.setState({ threadId: "019e061e-0000-7000-8000-000000000001" }, {} as never);
    view.surface.applyThreadListSnapshot([]);
    expect(view.getDisplayText()).toBe("Codex: 019e061e");
  });

  it("hydrates a restored thread when workspace state arrives after open", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledOnce();
    expect(client.resumeThread).not.toHaveBeenCalled();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("warms app-server metadata for an empty restored panel after the shell is open", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();

    expect(connectionMock.state.connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listModels).toHaveBeenCalledOnce();
    expect(client.listSkills).toHaveBeenCalledOnce();
    expect(client.readAccountRateLimits).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledWith("/vault", { archived: false, cursor: null, limit: 100 });
    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Restored thread");
    });
  });

  it("applies cached shared thread list and metadata when opened", async () => {
    const cachedThread = threadFixture("thread-cached");
    const view = await chatView({
      host: chatHost({
        cachedThreads: vi.fn(() => [cachedThread] as never[]),
        cachedAppServerMetadata: vi.fn(
          () =>
            ({
              runtimeConfig: { ...emptyRuntimeConfigSnapshot(), model: "gpt-cached" },
              availableModels: [],
              availableSkills: [{ name: "writer", enabled: true }],
              rateLimit: null,
              serverDiagnostics: createServerDiagnostics(),
            }) as never,
        ),
      }),
    });

    await view.onOpen();

    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Restored thread");
    });
    requiredButton(view.containerEl, '[aria-label="Show Codex status and settings"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("gpt-cached");
    });
  });

  it("hydrates a focused restored thread immediately", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(client.resumeThread).not.toHaveBeenCalled();
    await view.surface.focusThread("thread-1");

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("resumes a restored thread before sending the first message", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();
    view.surface.setComposerText("hello");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
      expect(client.startTurn).toHaveBeenCalledWith({
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "hello" }],
        clientUserMessageId: expect.stringMatching(/^local-user-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
      });
    });
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
  });

  it("does not revive a completed turn when the startTurn response arrives late", async () => {
    const startTurn = deferred<{ turn: { id: string } }>();
    const client = connectedClient({
      startTurn: vi.fn(() => startTurn.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");
    view.surface.setComposerText("hello");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => {
      expect(client.startTurn).toHaveBeenCalled();
    });

    connectionMock.state.onNotification?.(turnStartedNotification("thread-1", "turn-1"));
    connectionMock.state.onNotification?.(turnCompletedNotification("thread-1", "turn-1"));
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnLifecycle: { kind: "idle" } });

    startTurn.resolve({ turn: { id: "turn-1" } });
    await flushAsyncTicks();

    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnLifecycle: { kind: "idle" } });
  });

  it("requests a workspace layout save after resuming a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.openThread("thread-1");

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(requestSaveLayout).toHaveBeenCalledTimes(1);
  });

  it("resets to an unstarted empty chat without starting a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.openThread("thread-1");
    await view.surface.startNewThread();

    expect(client.startThread).not.toHaveBeenCalled();
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, turnLifecycle: { kind: "idle" }, hasComposerDraft: false });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("focuses the composer after panel thread actions", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => undefined);

    await view.surface.openThread("thread-1");
    await view.surface.focusThread("thread-1");
    await view.surface.startNewThread();

    expect(focus).toHaveBeenCalledTimes(3);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not start a thread when /clear is given arguments", async () => {
    const client = connectedClient({
      startThread: vi.fn().mockResolvedValue(startedThread("thread-new")),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.onOpen();
    await view.surface.connect();
    view.surface.setComposerText("/clear hello");
    await submitComposerByEnter(view);

    expect(client.startThread).not.toHaveBeenCalled();
    expect(client.startTurn).not.toHaveBeenCalled();
  });

  it("focuses an open panel instead of resuming a duplicate slash resume thread", async () => {
    const focusThreadInOpenView = vi.fn().mockResolvedValue(true);
    const host = chatHost({
      focusThreadInOpenView,
    });
    connectionMock.state.client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
    });
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    view.surface.setComposerText("/resume thread-1");
    await submitComposerByEnter(view);

    expect(focusThreadInOpenView).toHaveBeenCalledWith("thread-1");
    expect(connectionMock.state.client["resumeThread"]).not.toHaveBeenCalled();
  });

  it("resumes slash resume threads in the current panel when they are not already open", async () => {
    const focusThreadInOpenView = vi.fn().mockResolvedValue(false);
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView({
      host: chatHost({
        focusThreadInOpenView,
      }),
    });

    await view.onOpen();
    await view.surface.connect();
    view.surface.setComposerText("/resume thread-1");
    await submitComposerByEnter(view);

    expect(focusThreadInOpenView).toHaveBeenCalledWith("thread-1");
    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
  });

  it("keeps resumed messages pinned to bottom after slash resume in the same empty panel", async () => {
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.connect();
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: ESTIMATED_MESSAGE_BLOCK_HEIGHT, clientHeight: 100 });
    messages.scrollTop = 0;

    view.surface.setComposerText("/resume thread-1");
    await submitComposerByEnter(view);
    await waitForMessagesFrame(messages);
    await waitForMessagesFrame(messages);

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(0);
    restoreMessagesLayout();
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

    await view.onOpen();
    await view.surface.connect();
    view.surface.setComposerText("/archive thread-1");
    await submitComposerByEnter(view);

    expect(client.archiveThread).toHaveBeenCalledWith("thread-1");
    expect(notifyThreadArchived).toHaveBeenCalledWith("thread-1");
  });

  it("replaces the current panel with the forked thread after fork and archive", async () => {
    const notifyThreadArchived = vi.fn();
    const host = chatHost({ notifyThreadArchived });
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("source")] }),
      resumeThread: vi.fn((threadId: string) => Promise.resolve(resumedThread(threadId))),
      threadTurnsList: vi.fn().mockResolvedValue({ data: [completedTurn("turn-1")], nextCursor: null }),
      forkThread: vi.fn().mockResolvedValue({ thread: threadFixture("forked") }),
    });
    connectionMock.state.client = client;
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("source");
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("done");
    });
    requiredButton(view.containerEl, ".codex-panel__fork-message").click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__fork-and-archive-message")).not.toBeNull();
    });
    requiredButton(view.containerEl, ".codex-panel__fork-and-archive-message").click();

    await waitForAsyncWork(() => {
      expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
      expect(client.archiveThread).toHaveBeenCalledWith("source");
      expect(client.resumeThread).toHaveBeenLastCalledWith("forked", "/vault");
      expect(view.getState()).toEqual({ version: 1, threadId: "forked", threadTitle: "Restored thread" });
      expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "forked" });
      expect(notifyThreadArchived).toHaveBeenCalledWith("source");
    });
  });

  it("clears the active thread when another view archives it", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.openThread("thread-1");
    view.surface.notifyThreadArchived("thread-1");

    expect(view.getState()).toEqual({ version: 1 });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("updates restored panel title from shared rename notifications", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Before rename" }, {} as never);
    view.surface.notifyThreadRenamed("thread-1", "After rename");

    expect(view.getDisplayText()).toBe("Codex: After rename");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "After rename" });
  });

  it("does not use restored thread title as a composer name before an explicit rename notification", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored title" }, {} as never);
    await view.onOpen();

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");

    view.surface.notifyThreadRenamed("thread-1", "Explicit name");

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Explicit name”...");
    });
  });

  it("uses the active explicit thread name in the composer placeholder", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Restored thread”...");
  });

  it("does not use preview-only thread text in the composer placeholder", async () => {
    const client = connectedClient({
      resumeThread: vi.fn().mockResolvedValue({
        ...resumedThread("thread-1"),
        thread: { ...resumedThread("thread-1").thread, name: null, preview: "Restored preview" },
      }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");
  });

  it("updates the composer placeholder from shared rename notifications", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");
    view.surface.notifyThreadRenamed("thread-1", "Renamed thread");

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Renamed thread”...");
    });

    view.surface.notifyThreadRenamed("thread-1", null);

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");
    });
  });

  it("keeps composer draft and selection while updating the placeholder", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");
    view.surface.setComposerText("keep this draft");
    const composer = composerElement(view);
    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
    });
    composer.setSelectionRange(5, 9);

    view.surface.notifyThreadRenamed("thread-1", "Renamed thread");

    await waitForAsyncWork(() => {
      expect(composerElement(view)).toBe(composer);
      expect(composer.value).toBe("keep this draft");
      expect(composer.selectionStart).toBe(5);
      expect(composer.selectionEnd).toBe(9);
      expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
    });
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
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: ESTIMATED_MESSAGE_BLOCK_HEIGHT, clientHeight: 100 });
    messages.scrollTop = 0;

    await view.surface.openThread("thread-1");
    await waitForMessagesFrame(messages);
    await waitForMessagesFrame(messages);

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(0);
    restoreMessagesLayout();
  });

  it("leaves focused thread scroll position to the message stream", async () => {
    const client = connectedClient({
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: 1_000, clientHeight: 100 });

    await view.onOpen();
    await view.surface.openThread("thread-1");
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    messages.scrollTop = 0;

    await view.surface.focusThread("thread-1");

    expect(messages.scrollTop).toBe(0);
    restoreMessagesLayout();
  });

  it("leaves scroll position to the message stream when its leaf is focused", async () => {
    const activeLeafChangeListeners: ((leaf: unknown) => void)[] = [];
    const client = connectedClient({
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("restored prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView({ activeLeafChangeListeners });
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: 1_000, clientHeight: 100 });

    await view.onOpen();
    await view.surface.openThread("thread-1");
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    messages.scrollTop = 0;

    activeLeafChangeListeners.forEach((listener) => {
      listener((view as unknown as { leaf: unknown }).leaf);
    });

    expect(messages.scrollTop).toBe(0);
    restoreMessagesLayout();
  });

  it("renders resumed thread metadata before history hydration completes", async () => {
    const history = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      threadTurnsList: vi.fn(() => history.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const opening = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
    });

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).not.toContain("Loading thread...");

    history.resolve({ data: [], nextCursor: null });
    await opening;
  });

  it("hydrates resumed threads from the initial turns page without a second history request", async () => {
    const client = connectedClient({
      resumeThread: vi.fn().mockResolvedValue({
        ...resumedThread("thread-1"),
        initialTurnsPage: {
          data: [completedTurn("turn-1")],
          nextCursor: "older-cursor",
          backwardsCursor: null,
        },
      }),
      threadTurnsList: vi.fn().mockResolvedValue({ data: [turnWithUserMessage("fallback prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).not.toHaveBeenCalled();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("hello");
      expect(view.containerEl.textContent).toContain("done");
    });
  });

  it("ignores stale resume results when another thread is opened first", async () => {
    const firstResume = deferred<ReturnType<typeof resumedThread>>();
    const secondResume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      resumeThread: vi.fn((threadId: string) => (threadId === "thread-1" ? firstResume.promise : secondResume.promise)),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstOpen = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    });
    const secondOpen = view.surface.openThread("thread-2");
    await waitForAsyncWork(() => {
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

    const firstOpen = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
    });
    const secondOpen = view.surface.openThread("thread-2");
    await waitForAsyncWork(() => {
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
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
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

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(0);
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
    forkThread: vi.fn().mockResolvedValue({ thread: threadFixture("thread-forked") }),
    rollbackThread: vi.fn().mockResolvedValue({ thread: threadFixture("thread-forked") }),
    setThreadName: vi.fn().mockResolvedValue({}),
    getThreadGoal: vi.fn().mockResolvedValue({ goal: null }),
    setThreadGoal: vi.fn().mockResolvedValue({ goal: goalFixture("thread-1") }),
    injectThreadItems: vi.fn().mockResolvedValue({}),
    readThread: vi.fn().mockResolvedValue({ thread: threadFixture("thread-1") }),
    archiveThread: vi.fn().mockResolvedValue({}),
  };
}

function goalFixture(threadId: string) {
  return {
    threadId,
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
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
    approvalPolicy: "on-request",
    approvalsReviewer: null,
    activePermissionProfile: null,
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
    approvalPolicy: "on-request",
    approvalsReviewer: null,
    activePermissionProfile: null,
  };
}

function threadFixture(threadId: string): ThreadRecord {
  return {
    id: threadId,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Restored thread",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function panelThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ...overrides,
  };
}

function turnWithUserMessage(text: string) {
  return {
    id: "turn-1",
    startedAt: 1,
    completedAt: 2,
    items: [{ type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text, text_elements: [] }] }],
  };
}

function completedTurn(turnId: string) {
  return {
    id: turnId,
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    itemsView: "full",
    items: [
      { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
      { type: "agentMessage", id: "agent-1", text: "done", phase: "final_answer", memoryCitation: null },
    ],
  };
}

function turnStartedNotification(threadId: string, turnId: string): Extract<ServerNotification, { method: "turn/started" }> {
  return {
    method: "turn/started",
    params: {
      threadId,
      turn: {
        id: turnId,
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
        itemsView: "full",
        items: [],
      },
    },
  };
}

function turnCompletedNotification(threadId: string, turnId: string): Extract<ServerNotification, { method: "turn/completed" }> {
  return {
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: turnId,
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        itemsView: "full",
        items: [
          { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
          { type: "agentMessage", id: "agent-1", text: "done", phase: "final_answer", memoryCitation: null },
        ],
      },
    },
  };
}

function composerElement(view: { containerEl: HTMLElement }): HTMLTextAreaElement {
  const composer = view.containerEl.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input");
  if (!composer) throw new Error("Expected composer input");
  return composer;
}

function composerPlaceholder(view: { containerEl: HTMLElement }): string | null {
  return composerElement(view).getAttribute("placeholder");
}

function waitForMessagesFrame(messages: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    messages.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function mockMessagesLayout(metrics: { scrollHeight: number; clientHeight: number }): () => void {
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.scrollHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.clientHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.clientHeight : 0;
    },
  });
  return () => {
    restorePrototypeProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
  };
}

function mockMessageViewportOffsetMetrics(metrics: { clientHeight: number; clientWidth: number }): () => void {
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.clientHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.clientWidth : 0;
    },
  });
  return () => {
    restorePrototypeProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
  };
}

function restorePrototypeProperty<T extends object>(target: T, property: keyof T, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

function requiredTextArea(parent: ParentNode, selector: string): HTMLTextAreaElement {
  const element = parent.querySelector<HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

async function submitComposerByEnter(view: { containerEl: HTMLElement }): Promise<void> {
  await flushAsyncTicks();
  const composer = requiredTextArea(view.containerEl, ".codex-panel__composer-input");
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await flushAsyncTicks();
}

async function flushAsyncTicks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

interface ChatHostFixtureOverrides {
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  vaultPath?: string;
  openThreadInNewView?: CodexChatHost["workspace"]["openThreadInNewView"];
  focusThreadInOpenView?: CodexChatHost["workspace"]["focusThreadInOpenView"];
  openTurnDiff?: CodexChatHost["workspace"]["openTurnDiff"];
  notifyThreadArchived?: CodexChatHost["threadCatalog"]["notifyThreadArchived"];
  notifyThreadRenamed?: CodexChatHost["threadCatalog"]["notifyThreadRenamed"];
  refreshFromOpenSurface?: CodexChatHost["threadCatalog"]["refreshFromOpenSurface"];
  refreshThreadsViewLiveState?: CodexChatHost["threadCatalog"]["refreshThreadsViewLiveState"];
  applyThreads?: CodexChatHost["threadCatalog"]["applyThreads"];
  publishAppServerMetadata?: CodexChatHost["threadCatalog"]["publishAppServerMetadata"];
  refreshThreads?: CodexChatHost["threadCatalog"]["refreshThreads"];
  cachedThreads?: CodexChatHost["threadCatalog"]["cachedThreads"];
  cachedAppServerMetadata?: CodexChatHost["threadCatalog"]["cachedAppServerMetadata"];
}

function chatHost(overrides: ChatHostFixtureOverrides = {}): CodexChatHost {
  const settings = {
    ...DEFAULT_SETTINGS,
    codexPath: "codex",
    sendShortcut: "enter" as const,
    ...overrides.settings,
  };
  return {
    settingsRef: {
      settings,
      vaultPath: overrides.vaultPath ?? "/vault",
    },
    workspace: {
      openThreadInNewView: overrides.openThreadInNewView ?? vi.fn(),
      focusThreadInOpenView: overrides.focusThreadInOpenView ?? vi.fn().mockResolvedValue(false),
      openTurnDiff: overrides.openTurnDiff ?? vi.fn(),
    },
    threadCatalog: {
      notifyThreadArchived: overrides.notifyThreadArchived ?? vi.fn(),
      notifyThreadRenamed: overrides.notifyThreadRenamed ?? vi.fn(),
      refreshFromOpenSurface: overrides.refreshFromOpenSurface ?? vi.fn(),
      refreshThreadsViewLiveState: overrides.refreshThreadsViewLiveState ?? vi.fn(),
      applyThreads: overrides.applyThreads ?? vi.fn(),
      publishAppServerMetadata: overrides.publishAppServerMetadata ?? vi.fn(),
      refreshThreads:
        overrides.refreshThreads ??
        (vi.fn(
          (fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>,
        ) as CodexChatHost["threadCatalog"]["refreshThreads"]),
      cachedThreads: overrides.cachedThreads ?? vi.fn(() => null),
      cachedAppServerMetadata: overrides.cachedAppServerMetadata ?? vi.fn(() => null),
    },
  };
}

async function chatView(
  options: { activeLeafChangeListeners?: ((leaf: unknown) => void)[]; host?: CodexChatHost; requestSaveLayout?: () => void } = {},
) {
  const host = options.host ?? chatHost();
  const { CodexChatView } = await import("../../../src/features/chat/host/view");
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);
  containerEl.createDiv();
  containerEl.createDiv();
  return new CodexChatView(
    {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          getActiveViewOfType: vi.fn(() => null),
          getLastOpenFiles: vi.fn(() => []),
          on: vi.fn((eventName: string, callback: (leaf: unknown) => void) => {
            if (eventName === "active-leaf-change") options.activeLeafChangeListeners?.push(callback);
            return {};
          }),
          openLinkText: vi.fn(),
          requestSaveLayout: options.requestSaveLayout ?? vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
          getFiles: vi.fn(() => []),
          getMarkdownFiles: vi.fn(() => []),
        },
      },
      containerEl,
    } as never,
    host,
  );
}
