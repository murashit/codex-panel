// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { CodexChatHost } from "../../../src/features/chat/view";
import { createAppServerDiagnostics } from "../../../src/app-server/compatibility";
import { createChatState, type ChatState } from "../../../src/features/chat/chat-state";
import { composerSlotSnapshot } from "../../../src/features/chat/view-snapshot";
import type { ServerNotification } from "../../../src/generated/app-server/ServerNotification";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { installObsidianDomShims } from "../../support/dom";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connectCalls: 0,
    connected: false,
    onExit: null as (() => void) | null,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connectCalls = 0;
      state.connected = false;
      state.onExit = null;
    },
  };
});

vi.mock("../../../src/app-server/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    constructor(
      _codexPath: unknown,
      _cwd: unknown,
      private readonly handlers: { onExit: () => void },
    ) {
      connectionMock.state.onExit = handlers.onExit;
    }

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

    exit(): void {
      connectionMock.state.connected = false;
      this.handlers.onExit();
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

  it("keeps connect calls joined while metadata is still loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      readEffectiveConfig: vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstConnect = view.connect();
    await waitForAsyncWork(() => {
      expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    });

    let secondResolved = false;
    const secondConnect = view.connect().then(() => {
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
    const refreshThreadList = vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>);
    const threads = [threadFixture("thread-1")];
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: threads }),
    });
    connectionMock.state.client = client;
    const view = await chatView({
      host: chatHost({ refreshThreadList }),
    });

    await view.connect();

    expect(refreshThreadList).toHaveBeenCalledOnce();
    expect((view as unknown as { state: { listedThreads: unknown[] } }).state.listedThreads).toEqual(threads);
  });

  it("publishes app-server metadata after connecting", async () => {
    const publishAppServerMetadata = vi.fn();
    connectionMock.state.client = connectedClient();
    const view = await chatView({
      host: chatHost({ publishAppServerMetadata }),
    });

    await view.connect();

    expect(publishAppServerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveConfig: {},
        availableModels: [],
        availableSkills: [],
      }),
    );
  });

  it("renders the chat shell on the view content root", async () => {
    const view = await chatView();

    await view.onOpen();

    const root = view.containerEl.children[1] as HTMLElement;
    expect(root.classList.contains("codex-panel")).toBe(true);
    expect(root.querySelector(":scope > .codex-panel__toolbar")).not.toBeNull();
    expect(root.querySelector(":scope > .codex-panel__body .codex-panel__slot--messages")).not.toBeNull();
    expect(root.querySelector(":scope > .codex-panel__body .codex-panel__slot--composer")).not.toBeNull();
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

  it("ignores stale connection work after the app-server exits during metadata loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      readEffectiveConfig: vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const connecting = view.connect();
    await waitForAsyncWork(() => {
      expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    });
    connectionMock.state.onExit?.();

    config.resolve({});
    await connecting;

    expect(client.listThreads).not.toHaveBeenCalled();
    expect((view as unknown as { state: { status: string } }).state.status).toBe("Codex app-server stopped.");
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

    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledOnce();
    expect(client.resumeThread).not.toHaveBeenCalled();

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
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")] }),
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
    expect(client.listThreads).toHaveBeenCalledWith("/vault");
    expect((view as unknown as { state: { listedThreads: unknown[] } }).state.listedThreads).toEqual([threadFixture("thread-1")]);
  });

  it("applies cached shared thread list and metadata when opened", async () => {
    const cachedThread = threadFixture("thread-cached");
    const view = await chatView({
      host: chatHost({
        cachedThreadList: vi.fn(() => [cachedThread] as never[]),
        cachedAppServerMetadata: vi.fn(
          () =>
            ({
              effectiveConfig: { config: { model: "gpt-cached" }, origins: {}, layers: [] },
              availableModels: [],
              availableSkills: [{ name: "writer", enabled: true }],
              rateLimit: null,
              appServerDiagnostics: createAppServerDiagnostics(),
            }) as never,
        ),
      }),
    });

    await view.onOpen();

    const state = (
      view as unknown as {
        state: { listedThreads: unknown[]; effectiveConfig: unknown; availableModels: unknown[]; availableSkills: unknown[] };
      }
    ).state;
    expect(state.listedThreads).toEqual([cachedThread]);
    expect(state.effectiveConfig).toEqual({ config: { model: "gpt-cached" }, origins: {}, layers: [] });
    expect(state.availableModels).toEqual([]);
    expect(state.availableSkills).toEqual([{ name: "writer", enabled: true }]);
  });

  it("tracks composer slot dependencies for model and skill suggestions", async () => {
    await chatView();
    const state = createChatState();
    state.effectiveConfig = effectiveConfig("gpt-configured");
    state.availableSkills = [skillFixture("writer")];

    const base = composerSlotSnapshot(state, null);

    expect(composerSlotSnapshot({ ...state, effectiveConfig: effectiveConfig("gpt-updated") }, null)).not.toBe(base);
    expect(composerSlotSnapshot({ ...state, requestedModel: { kind: "set", value: "gpt-requested" } }, null)).not.toBe(base);
    expect(composerSlotSnapshot({ ...state, availableSkills: [skillFixture("reader")] }, null)).not.toBe(base);
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

  it("does not revive a completed turn when the startTurn response arrives late", async () => {
    const startTurn = deferred<{ turn: { id: string } }>();
    const client = connectedClient({
      startTurn: vi.fn(() => startTurn.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.openThread("thread-1");
    view.setComposerText("hello");
    const submit = (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();
    await waitForAsyncWork(() => {
      expect(client.startTurn).toHaveBeenCalled();
    });

    const controller = (view as unknown as { controller: { handleNotification: (notification: ServerNotification) => void } }).controller;
    controller.handleNotification(turnStartedNotification("thread-1", "turn-1"));
    controller.handleNotification(turnCompletedNotification("thread-1", "turn-1"));
    expect((view as unknown as { state: ChatState }).state.turnLifecycle).toEqual({ kind: "idle" });

    startTurn.resolve({ turn: { id: "turn-1" } });
    await submit;

    expect((view as unknown as { state: ChatState }).state.turnLifecycle).toEqual({ kind: "idle" });
    expect(view.openPanelSnapshot()).toMatchObject({ turnLifecycle: { kind: "idle" } });
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
    expect(view.openPanelSnapshot()).toMatchObject({ threadId: null, turnLifecycle: { kind: "idle" }, hasComposerDraft: false });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("focuses the composer after panel thread actions", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => undefined);

    await view.openThread("thread-1");
    await view.focusThread("thread-1");
    await view.startNewThread();

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
    await view.connect();
    view.setComposerText("/clear hello");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

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

    await view.connect();
    view.setComposerText("/resume thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

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

    await view.connect();
    view.setComposerText("/resume thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

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
    await view.connect();
    const messages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: 1000, clientHeight: 100 });
    messages.scrollTop = 0;

    view.setComposerText("/resume thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();
    await waitForMessagesFrame(messages);
    await waitForMessagesFrame(messages);

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(1000);
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

    await view.connect();
    view.setComposerText("/archive thread-1");
    await (view as unknown as { submitComposerAction: () => Promise<void> }).submitComposerAction();

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

    await view.connect();
    await view.openThread("source");
    await (
      view as unknown as {
        threadActions: { forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => Promise<void> };
      }
    ).threadActions.forkThreadFromTurn("source", "turn-1", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(client.resumeThread).toHaveBeenLastCalledWith("forked", "/vault");
    expect(view.getState()).toEqual({ version: 1, threadId: "forked", threadTitle: "Restored thread" });
    expect(view.openPanelSnapshot()).toMatchObject({ threadId: "forked" });
    expect(notifyThreadArchived).toHaveBeenCalledWith("source");
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

  it("does not use restored thread title as a composer name before an explicit rename notification", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored title" }, {} as never);
    await view.onOpen();

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");

    view.notifyThreadRenamed("thread-1", "Explicit name");

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Explicit name”...");
  });

  it("uses the active explicit thread name in the composer placeholder", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.openThread("thread-1");

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

    await view.openThread("thread-1");

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");
  });

  it("updates the composer placeholder from shared rename notifications", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.openThread("thread-1");
    view.notifyThreadRenamed("thread-1", "Renamed thread");

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Renamed thread”...");

    view.notifyThreadRenamed("thread-1", null);

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");
  });

  it("keeps composer draft and selection while updating the placeholder", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.openThread("thread-1");
    view.setComposerText("keep this draft");
    const composer = composerElement(view);
    composer.setSelectionRange(5, 9);

    view.notifyThreadRenamed("thread-1", "Renamed thread");

    expect(composerElement(view)).toBe(composer);
    expect(composer.value).toBe("keep this draft");
    expect(composer.selectionStart).toBe(5);
    expect(composer.selectionEnd).toBe(9);
    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
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
    const restoreMessagesLayout = mockMessagesLayout({ scrollHeight: 1000, clientHeight: 100 });
    messages.scrollTop = 0;

    await view.openThread("thread-1");
    await waitForMessagesFrame(messages);
    await waitForMessagesFrame(messages);

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(1000);
    restoreMessagesLayout();
  });

  it("renders resumed thread metadata before history hydration completes", async () => {
    const history = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      threadTurnsList: vi.fn(() => history.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const opening = view.openThread("thread-1");
    await waitForAsyncWork(() => {
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
    await waitForAsyncWork(() => {
      expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    });
    const secondOpen = view.openThread("thread-2");
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

    const firstOpen = view.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
    });
    const secondOpen = view.openThread("thread-2");
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

    const renderedMessages = view.containerEl.querySelector<HTMLElement>(".codex-panel__messages");
    expect(renderedMessages?.scrollTop).toBe(1000);
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
    readThread: vi.fn().mockResolvedValue({ thread: threadFixture("thread-1") }),
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

function effectiveConfig(model: string): ChatState["effectiveConfig"] {
  return { config: { model }, origins: {}, layers: [] } as never;
}

function skillFixture(name: string): ChatState["availableSkills"][number] {
  return {
    name,
    description: `${name} skill`,
    path: `/skills/${name}/SKILL.md`,
    scope: "repo",
    enabled: true,
  } as ChatState["availableSkills"][number];
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
  return () => {
    restorePrototypeProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  };
}

function restorePrototypeProperty<T extends object>(target: T, property: keyof T, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
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
    focusThreadInOpenView: vi.fn().mockResolvedValue(false),
    openTurnDiff: vi.fn(),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    refreshSharedThreadListFromOpenSurface: vi.fn(),
    refreshThreadsViewLiveState: vi.fn(),
    applyThreadListSnapshot: vi.fn(),
    refreshThreadList: vi.fn(
      (fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>,
    ) as CodexChatHost["refreshThreadList"],
    cachedThreadList: vi.fn(() => null),
    publishAppServerMetadata: vi.fn(),
    cachedAppServerMetadata: vi.fn(() => null),
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
