// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../src/app-server/connection/rpc-messages";
import { modelMetadataFromCatalogModels } from "../../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../../src/app-server/protocol/thread";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { ObservedDataResult } from "../../../src/domain/observed-data";
import { emptyRuntimeConfigSnapshot } from "../../../src/domain/runtime/config";
import { createServerDiagnostics } from "../../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../src/domain/server/metadata";
import type { Thread } from "../../../src/domain/threads/model";
import type { CodexChatHost } from "../../../src/features/chat/host/environment";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { ThreadCatalogEvent } from "../../../src/workspace/thread-catalog";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { installObsidianDomShims } from "../../support/dom";

type TestCodexChatHost = CodexChatHost;
let CodexChatView: typeof import("../../../src/features/chat/host/view")["CodexChatView"];
interface TrackedView {
  view: { onClose(): Promise<void> | void };
  opened: boolean;
}
let createdViews: TrackedView[] = [];

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

    resetConnection(): void {
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

  beforeAll(async () => {
    ({ CodexChatView } = await import("../../../src/features/chat/host/view"));
  });

  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
    restoreDefaultMessageViewportMetrics = mockMessageViewportOffsetMetrics({ clientHeight: 320, clientWidth: 240 });
  });

  afterEach(async () => {
    for (const entry of createdViews.reverse()) {
      if (entry.opened) await entry.view.onClose();
    }
    createdViews = [];
    restoreDefaultMessageViewportMetrics?.();
    restoreDefaultMessageViewportMetrics = null;
    document.body.replaceChildren();
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMock.state.client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await Promise.all([view.surface.connect(), view.surface.connect()]);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
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

  it("loads app-server metadata after connecting", async () => {
    connectionMock.state.client = connectedClient();
    const view = await chatView();

    await view.surface.connect();

    expect(connectionMock.state.client["readEffectiveConfig"]).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });
  });

  it("resets the app-server connection only when settings change the app-server context", async () => {
    connectionMock.state.client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    host.settingsRef.settings.showToolbar = false;
    view.surface.refreshSettings();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    host.settingsRef.settings.codexPath = "codex-next";
    view.surface.refreshSettings();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: false });
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

  it("restores workspace thread state without hydrating it automatically", async () => {
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
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(connectionMock.state.connectCalls).toBe(0);
    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(view.containerEl.textContent).not.toContain("Thread restored. Send a message to resume it.");

    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(client.listThreads).toHaveBeenCalledOnce();
    expect(client.resumeThread).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(client.threadTurnsList).not.toHaveBeenCalled();
  });

  it("formats the panel title from listed thread metadata", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-named" }, {} as never);
    await view.onOpen();
    host.threadCatalog.apply({ type: "active-list-snapshot-received", threads: [panelThread({ id: "thread-named", name: "作業メモ" })] });
    expect(view.getDisplayText()).toBe("Codex: 作業メモ");

    host.threadCatalog.apply({
      type: "active-list-snapshot-received",
      threads: [panelThread({ id: "thread-named", name: null, preview: "初回依頼" })],
    });
    expect(view.getDisplayText()).toBe("Codex: 初回依頼");

    await view.setState({ threadId: "019e061e-0000-7000-8000-000000000001" }, {} as never);
    host.threadCatalog.apply({ type: "active-list-snapshot-received", threads: [] });
    expect(view.getDisplayText()).toBe("Codex: 019e061e");
  });

  it("keeps late workspace thread state restored until explicit focus", async () => {
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

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(client.threadTurnsList).not.toHaveBeenCalled();

    await view.surface.focusThread("thread-1");

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/vault");
    expect(client.threadTurnsList).toHaveBeenCalledWith("thread-1", null, 20);
  });

  it("warms app-server metadata for an empty restored panel after the shell is open", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")], nextCursor: null }),
    });
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMock.state.client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await view.onOpen();

    expect(connectionMock.state.connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledOnce();
    expect(fetchModels).toHaveBeenCalledOnce();
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
        activeSnapshot: vi.fn(() => [cachedThread] as never[]),
        appServerMetadataSnapshot: vi.fn(
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
    requiredButton(view.containerEl, '[aria-label="Show status"]').click();
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

  it("clears the active thread when another view archives it", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.openThread("thread-1");
    view.surface.applyThreadArchived("thread-1");

    expect(view.getState()).toEqual({ version: 1 });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("updates restored panel title from shared rename notifications", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Before rename" }, {} as never);
    view.surface.applyThreadRenamed("thread-1", "After rename");

    expect(view.getDisplayText()).toBe("Codex: After rename");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "After rename" });
  });

  it("does not use restored thread title as a composer name before an explicit rename notification", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-1", threadTitle: "Restored title" }, {} as never);
    await view.onOpen();

    expect(composerPlaceholder(view)).toBe("Ask Codex to work on this task...");

    host.threadCatalog.apply({ type: "active-list-snapshot-received", threads: [panelThread({ id: "thread-1", name: "Explicit name" })] });
    view.surface.applyThreadRenamed("thread-1", "Explicit name");

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex to work on “Explicit name”...");
    });
  });

  it("keeps composer draft and selection while updating the placeholder", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.openThread("thread-1");
    view.surface.setComposerText("keep this draft");
    const composer = composerElement(view);
    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
    });
    composer.setSelectionRange(5, 9);

    host.threadCatalog.apply({ type: "active-list-snapshot-received", threads: [panelThread({ id: "thread-1", name: "Renamed thread" })] });
    view.surface.applyThreadRenamed("thread-1", "Renamed thread");

    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
      expect(composer.selectionStart).toBe(5);
      expect(composer.selectionEnd).toBe(9);
      expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
    });
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

function threadFromRecord(record: ThreadRecord): Thread {
  return {
    id: record.id,
    preview: record.preview,
    name: record.name,
    archived: false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

function composerElement(view: { containerEl: HTMLElement }): HTMLTextAreaElement {
  const composer = view.containerEl.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input");
  if (!composer) throw new Error("Expected composer input");
  return composer;
}

function composerPlaceholder(view: { containerEl: HTMLElement }): string | null {
  return composerElement(view).getAttribute("placeholder");
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
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

interface ChatHostFixtureOverrides {
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  vaultPath?: string;
  openThreadInNewView?: CodexChatHost["workspace"]["openThreadInNewView"];
  focusThreadInOpenView?: CodexChatHost["workspace"]["focusThreadInOpenView"];
  openTurnDiff?: CodexChatHost["workspace"]["openTurnDiff"];
  refreshThreadsViewLiveState?: CodexChatHost["workspace"]["refreshThreadsViewLiveState"];
  applyThreadCatalogEvent?: CodexChatHost["threadCatalog"]["apply"];
  updateAppServerMetadata?: CodexChatHost["appServerData"]["updateAppServerMetadata"];
  refreshActive?: CodexChatHost["threadCatalog"]["refreshActive"];
  activeSnapshot?: CodexChatHost["threadCatalog"]["activeSnapshot"];
  appServerMetadataSnapshot?: CodexChatHost["appServerData"]["appServerMetadataSnapshot"];
  modelsSnapshot?: CodexChatHost["appServerData"]["modelsSnapshot"];
  fetchModels?: CodexChatHost["appServerData"]["fetchModels"];
  refreshModels?: CodexChatHost["appServerData"]["refreshModels"];
  refreshAppServerMetadata?: CodexChatHost["appServerData"]["refreshAppServerMetadata"];
}

function chatHost(overrides: ChatHostFixtureOverrides = {}): TestCodexChatHost {
  let activeThreads = overrides.activeSnapshot?.() ?? null;
  let metadata = overrides.appServerMetadataSnapshot?.() ?? null;
  const models = overrides.modelsSnapshot?.() ?? null;
  const activeThreadResultListeners = new Set<(result: ObservedDataResult<readonly Thread[]>) => void>();
  const metadataResultListeners = new Set<(result: ObservedDataResult<SharedServerMetadata>) => void>();
  const modelResultListeners = new Set<(result: ObservedDataResult<readonly ModelMetadata[]>) => void>();
  const settings = {
    ...DEFAULT_SETTINGS,
    codexPath: "codex",
    sendShortcut: "enter" as const,
    ...overrides.settings,
  };
  const vaultPath = overrides.vaultPath ?? "/vault";
  const applyMetadataToCache = (nextMetadata: SharedServerMetadata): SharedServerMetadata => {
    metadata = nextMetadata;
    for (const listener of metadataResultListeners) listener(queryResult(nextMetadata));
    for (const listener of modelResultListeners) listener(queryResult(nextMetadata.availableModels));
    return nextMetadata;
  };
  const loadAppServerMetadata = async (): Promise<SharedServerMetadata | null> => {
    const client = connectionMock.state.client as ReturnType<typeof baseClient> | null;
    if (!client || !connectionMock.state.connected) return null;
    const connectionStillCurrent = () => connectionMock.state.client === client && connectionMock.state.connected;
    await client.readEffectiveConfig(vaultPath);
    if (!connectionStillCurrent()) return null;
    const availableModels = overrides.fetchModels
      ? await overrides.fetchModels()
      : modelMetadataFromCatalogModels((await client.listModels(false)).data as Parameters<typeof modelMetadataFromCatalogModels>[0]);
    if (!connectionStillCurrent()) return null;
    const skillsResponse = await client.listSkills(vaultPath);
    if (!connectionStillCurrent()) return null;
    await client.readAccountRateLimits();
    if (!connectionStillCurrent()) return null;
    return {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels,
      availableSkills: skillsResponse.data.flatMap(
        (entry: { skills: { name: string; description?: string; path?: string; enabled?: boolean }[] }) =>
          entry.skills.map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            path: skill.path ?? "",
            enabled: skill.enabled ?? true,
          })),
      ),
      rateLimit: null,
      serverDiagnostics: createServerDiagnostics(),
    };
  };
  const emitActiveThreads = (): void => {
    if (!activeThreads) return;
    for (const listener of activeThreadResultListeners) listener(queryResult(activeThreads));
  };
  const upsertActiveThread = (thread: Thread): void => {
    activeThreads = [thread, ...(activeThreads?.filter((item) => item.id !== thread.id) ?? [])];
    emitActiveThreads();
  };
  const applyThreadCatalogEvent = (event: ThreadCatalogEvent): void => {
    switch (event.type) {
      case "active-list-snapshot-received":
        activeThreads = event.threads;
        emitActiveThreads();
        return;
      case "thread-archived":
      case "thread-deleted":
        activeThreads = activeThreads?.filter((thread) => thread.id !== event.threadId) ?? null;
        emitActiveThreads();
        return;
      case "thread-renamed":
        activeThreads = activeThreads?.map((thread) => (thread.id === event.threadId ? { ...thread, name: event.name } : thread)) ?? null;
        emitActiveThreads();
        return;
      case "thread-started":
      case "thread-forked":
      case "thread-restored":
        upsertActiveThread(event.thread);
        return;
      case "thread-touched":
        activeThreads =
          activeThreads?.map((thread) =>
            thread.id === event.threadId && event.recencyAt !== undefined ? { ...thread, recencyAt: event.recencyAt } : thread,
          ) ?? activeThreads;
        emitActiveThreads();
        return;
      case "archived-list-snapshot-received":
      case "thread-unarchived":
        return;
    }
  };
  return {
    settingsRef: {
      settings,
      vaultPath,
    },
    workspace: {
      openThreadInNewView: overrides.openThreadInNewView ?? vi.fn(),
      focusThreadInOpenView: overrides.focusThreadInOpenView ?? vi.fn().mockResolvedValue(false),
      openTurnDiff: overrides.openTurnDiff ?? vi.fn(),
      refreshThreadsViewLiveState: overrides.refreshThreadsViewLiveState ?? vi.fn(),
    },
    appServerData: {
      updateAppServerMetadata:
        overrides.updateAppServerMetadata ??
        ((updater) => {
          const nextMetadata = updater(metadata);
          if (!nextMetadata) return null;
          return applyMetadataToCache(nextMetadata);
        }),
      appServerMetadataSnapshot: overrides.appServerMetadataSnapshot ?? vi.fn(() => metadata),
      refreshAppServerMetadata:
        overrides.refreshAppServerMetadata ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata();
          return nextMetadata ? applyMetadataToCache(nextMetadata) : null;
        }),
      modelsSnapshot: overrides.modelsSnapshot ?? vi.fn(() => models),
      fetchModels: overrides.fetchModels ?? vi.fn(async () => models ?? []),
      refreshModels: overrides.refreshModels ?? vi.fn(async () => models ?? []),
      observeAppServerMetadataResult: (listener, options = {}) => {
        metadataResultListeners.add(listener);
        if ((options.emitCurrent ?? true) && metadata) listener(queryResult(metadata));
        return () => {
          metadataResultListeners.delete(listener);
        };
      },
      observeModelsResult: (listener, options = {}) => {
        modelResultListeners.add(listener);
        if ((options.emitCurrent ?? true) && models) listener(queryResult(models));
        return () => {
          modelResultListeners.delete(listener);
        };
      },
    },
    threadCatalog: {
      apply: overrides.applyThreadCatalogEvent ?? applyThreadCatalogEvent,
      refreshActive:
        overrides.refreshActive ??
        (vi.fn(async () => {
          const client = connectionMock.state.client;
          if (!client) return activeThreads ?? [];
          const listThreads = client["listThreads"] as (cwd: string, options: Record<string, unknown>) => Promise<{ data: ThreadRecord[] }>;
          const response = await listThreads("/vault", { archived: false, cursor: null, limit: 100 });
          activeThreads = response.data.map(threadFromRecord);
          for (const listener of activeThreadResultListeners) listener(queryResult(activeThreads));
          return activeThreads;
        }) as CodexChatHost["threadCatalog"]["refreshActive"]),
      loadActive: vi.fn(async () => activeThreads ?? []),
      activeSnapshot: overrides.activeSnapshot ?? vi.fn(() => activeThreads),
      observeActive: (listener, options = {}) => {
        activeThreadResultListeners.add(listener);
        if ((options.emitCurrent ?? true) && activeThreads) listener(queryResult(activeThreads));
        return () => {
          activeThreadResultListeners.delete(listener);
        };
      },
    },
  };
}

function queryResult<T>(data: T | null): ObservedDataResult<T> {
  return {
    data,
    error: null,
    isFetching: false,
  };
}

async function chatView(options: { host?: CodexChatHost; requestSaveLayout?: () => void } = {}) {
  const host = options.host ?? chatHost();
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);
  containerEl.createDiv();
  containerEl.createDiv();
  const view = new CodexChatView(
    {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          getActiveViewOfType: vi.fn(() => null),
          getLastOpenFiles: vi.fn(() => []),
          on: vi.fn(() => ({})),
          openLinkText: vi.fn(),
          requestSaveLayout: options.requestSaveLayout ?? vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
          offref: vi.fn(),
          getFiles: vi.fn(() => []),
          getMarkdownFiles: vi.fn(() => []),
          getAbstractFileByPath: vi.fn(() => null),
        },
        metadataCache: {
          on: vi.fn(() => ({})),
          offref: vi.fn(),
          getFirstLinkpathDest: vi.fn(() => null),
          fileToLinktext: vi.fn(() => ""),
          getFileCache: vi.fn(() => null),
        },
      },
      containerEl,
    } as never,
    host,
  );
  const tracked: TrackedView = { view, opened: false };
  const onOpen = view.onOpen.bind(view);
  const onClose = view.onClose.bind(view);
  view.onOpen = async () => {
    tracked.opened = true;
    await onOpen();
  };
  view.onClose = async () => {
    tracked.opened = false;
    await onClose();
  };
  createdViews.push(tracked);
  return view;
}
