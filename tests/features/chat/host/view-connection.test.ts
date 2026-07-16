// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { modelMetadataFromCatalogModels } from "../../../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { ObservedResult } from "../../../../src/app-server/query/observed-result";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import { createServerDiagnostics } from "../../../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../src/domain/server/metadata";
import type { Thread } from "../../../../src/domain/threads/model";
import type { CodexChatHost } from "../../../../src/features/chat/host/contracts";
import type { ThreadCatalogEvent } from "../../../../src/features/threads/catalog/thread-catalog";
import { createThreadNameMutationCoordinator } from "../../../../src/features/threads/workflows/thread-name-mutation-coordinator";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { notices } from "../../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../../support/async";
import { installObsidianDomShims } from "../../../support/dom";
import { chatPanelSettingsAccess } from "../support/settings";

interface TestCodexChatHost extends CodexChatHost {
  readonly settingsSource: CodexPanelSettings;
  receiveActiveThreads(threads: readonly Thread[]): void;
}
let CodexChatView: typeof import("../../../../src/features/chat/host/view.obsidian")["CodexChatView"];
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

vi.mock("../../../../src/app-server/connection/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    private readonly codexPath: () => string;
    private readonly cwd: string;
    private handlers: {
      onNotification: (notification: ServerNotification, context: { codexPath: string; cwd: string }) => void;
      onServerRequest: (
        request: unknown,
        responder: { respond(result: unknown): void; reject(code: number, message: string): void },
      ) => void;
      onLog: (message: string) => void;
      onExit: (context: { codexPath: string; cwd: string }) => void;
    } | null;

    constructor(codexPath: () => string, cwd: string) {
      this.codexPath = codexPath;
      this.cwd = cwd;
      this.handlers = null;
    }

    connect(handlers: {
      onNotification: (notification: ServerNotification, context: { codexPath: string; cwd: string }) => void;
      onServerRequest: (
        request: unknown,
        responder: { respond(result: unknown): void; reject(code: number, message: string): void },
      ) => void;
      onLog: (message: string) => void;
      onExit: (context: { codexPath: string; cwd: string }) => void;
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
      this.handlers?.onExit({ codexPath: this.codexPath(), cwd: this.cwd });
    }

    private publishHandlers(handlers: NonNullable<ConnectionManager["handlers"]>): void {
      const context = { codexPath: this.codexPath(), cwd: this.cwd };
      connectionMock.state.onNotification = (notification) => handlers.onNotification(notification, context);
      connectionMock.state.onExit = () => handlers.onExit(context);
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

installObsidianDomShims();

describe("CodexChatView connection lifecycle", () => {
  let restoreDefaultThreadStreamViewportMetrics: (() => void) | null = null;

  beforeAll(async () => {
    ({ CodexChatView } = await import("../../../../src/features/chat/host/view.obsidian"));
  });

  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
    restoreDefaultThreadStreamViewportMetrics = mockThreadStreamViewportOffsetMetrics({ clientHeight: 320, clientWidth: 240 });
  });

  afterEach(async () => {
    for (const entry of createdViews.reverse()) {
      if (entry.opened) await entry.view.onClose();
    }
    createdViews = [];
    vi.useRealTimers();
    restoreDefaultThreadStreamViewportMetrics?.();
    restoreDefaultThreadStreamViewportMetrics = null;
    document.body.replaceChildren();
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMock.state.client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await Promise.all([view.surface.connect(), view.surface.connect()]);

    expect(connectionMock.state.connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expectRequestTimes(client, "skills/list", 1);
    expectRequestTimes(client, "permissionProfile/list", 1);
    expectRequestTimes(client, "account/rateLimits/read", 1);
    expectRequestTimes(client, "thread/list", 1);
  });

  it("keeps connect calls joined while metadata is still loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstConnect = view.surface.connect();
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
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

    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 1);
  });

  it("loads app-server metadata after connecting", async () => {
    connectionMock.state.client = connectedClient();
    const view = await chatView();

    await view.surface.connect();

    expectRequestTimes(connectionMock.state.client as TestAppServerClient, "config/read", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });
  });

  it("reconnects and resumes the active thread only when settings change the app-server context", async () => {
    connectionMock.state.client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    host.settingsSource.showToolbar = false;
    view.surface.refreshSettings();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    await view.surface.openThread("thread-1");
    const nextClient = connectedClient();
    connectionMock.state.client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(connectionMock.state.connectCalls).toBe(2);
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("invalidates the old connection before publishing a new app-server context", async () => {
    connectionMock.state.client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.surface.connect();
    expect(view.surface.openPanelSnapshot().connected).toBe(true);

    view.surface.prepareAppServerContextChange();

    expect(view.surface.openPanelSnapshot().connected).toBe(false);
    expect(host.settingsSource.codexPath).toBe("codex");
    expect(connectionMock.state.connectCalls).toBe(1);

    connectionMock.state.client = connectedClient();
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(connectionMock.state.connectCalls).toBe(2);
      expect(view.surface.openPanelSnapshot().connected).toBe(true);
    });
  });

  it("resumes each panel's captured thread after a shared app-server context replacement", async () => {
    const host = chatHost();
    const resumeRequestedThread = vi.fn((params: unknown) => {
      const threadId = (params as { threadId: string }).threadId;
      return resumedThread(threadId);
    });
    const oldClient = connectedClient({ "thread/resume": resumeRequestedThread });
    connectionMock.state.client = oldClient;
    const first = await chatView({ host });
    const second = await chatView({ host });

    await first.onOpen();
    await second.onOpen();
    await first.surface.connect();
    await second.surface.connect();
    await first.surface.openThread("thread-1");
    await second.surface.openThread("thread-2");

    first.surface.prepareAppServerContextChange();
    second.surface.prepareAppServerContextChange();
    const nextClient = connectedClient({ "thread/resume": resumeRequestedThread });
    connectionMock.state.client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    first.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    });

    connectionMock.state.connected = false;
    second.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-2", cwd: "/vault" }));
      expect(first.surface.openPanelSnapshot().threadId).toBe("thread-1");
      expect(second.surface.openPanelSnapshot().threadId).toBe("thread-2");
    });
  });

  it("keeps the captured thread across consecutive app-server context replacements", async () => {
    const host = chatHost();
    const firstClient = connectedClient();
    connectionMock.state.client = firstClient;
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const stalledConfig = deferred<unknown>();
    const stalledClient = connectedClient({ "config/read": vi.fn(() => stalledConfig.promise) });
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = stalledClient;
    host.settingsSource.codexPath = "codex-broken";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(stalledClient, "config/read", 1);
    });

    const recoveredClient = connectedClient();
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = recoveredClient;
    host.settingsSource.codexPath = "codex-recovered";
    view.surface.refreshSettings();

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });

    stalledConfig.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectRequestTimes(recoveredClient, "thread/resume", 1);
  });

  it("keeps the captured thread after a context reconnect cannot resume it", async () => {
    const host = chatHost();
    connectionMock.state.client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const failedClient = connectedClient({ "thread/resume": vi.fn().mockResolvedValue(null) });
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = failedClient;
    host.settingsSource.codexPath = "codex-broken";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(failedClient, "thread/resume", 1);
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: null });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveredClient = connectedClient();
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = recoveredClient;
    host.settingsSource.codexPath = "codex-recovered";
    view.surface.refreshSettings();

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("retries the captured thread when reconnecting after a context resume failure", async () => {
    const host = chatHost();
    connectionMock.state.client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const failedClient = connectedClient({ "thread/resume": vi.fn().mockResolvedValue(null) });
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = failedClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(failedClient, "thread/resume", 1);
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: null });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveredClient = connectedClient();
    connectionMock.state.client = recoveredClient;
    view.surface.setComposerText("/reconnect");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("does not let a stale automatic reconnect resume again after a manual retry", async () => {
    const host = chatHost();
    connectionMock.state.client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const stalledConfig = deferred<unknown>();
    const stalledClient = connectedClient({ "config/read": vi.fn(() => stalledConfig.promise) });
    view.surface.prepareAppServerContextChange();
    connectionMock.state.client = stalledClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(stalledClient, "config/read", 1);
    });

    const recoveredClient = connectedClient();
    connectionMock.state.client = recoveredClient;
    view.surface.setComposerText("/reconnect");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => {
      expectRequestTimes(recoveredClient, "thread/resume", 1);
    });

    stalledConfig.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectRequestTimes(recoveredClient, "thread/resume", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
  });

  it("starts an empty thread when saving a toolbar goal from a blank panel", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/goal/set": vi.fn().mockResolvedValue({
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
      expect(client.request).toHaveBeenCalledWith("thread/start", { cwd: "/vault", serviceName: "codex-panel" });
      expect(client.request).toHaveBeenCalledWith("thread/goal/set", {
        threadId: "thread-new",
        objective: "Ship the feature",
        status: "active",
        tokenBudget: null,
      });
    });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/inject_items", {
        threadId: "thread-new",
        items: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Ship the feature" }],
          },
        ],
      });
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-new" });
    expect(view.containerEl.textContent).toContain("Ship the feature");
  });

  it("ignores stale connection work after the view closes", async () => {
    let resolveConfig!: (value: unknown) => void;
    const client = connectedClient({
      "config/read": vi.fn(
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
    expect(requestMethods(client)).not.toContain("thread/list");
  });

  it("ignores stale connection work after the app-server exits during metadata loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const connecting = view.surface.connect();
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
    });
    connectionMock.state.connected = false;
    connectionMock.state.onExit?.();

    config.resolve({});
    await connecting;

    expect(requestMethods(client)).not.toContain("thread/list");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: false });
  });

  it("restores workspace thread state without hydrating it automatically", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-1")),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(connectionMock.state.connectCalls).toBe(0);
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(view.containerEl.textContent).not.toContain("Thread restored. Send a message to resume it.");

    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 1);
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");
  });

  it("formats the panel title from listed thread metadata", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-named" }, {} as never);
    await view.onOpen();
    host.receiveActiveThreads([panelThread({ id: "thread-named", name: "作業メモ" })]);
    expect(view.getDisplayText()).toBe("Codex: 作業メモ");

    host.receiveActiveThreads([panelThread({ id: "thread-named", name: null, preview: "初回依頼" })]);
    expect(view.getDisplayText()).toBe("Codex: 初回依頼");

    await view.setState({ threadId: "019e061e-0000-7000-8000-000000000001" }, {} as never);
    host.receiveActiveThreads([]);
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
    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 1);
    expect(requestMethods(client)).not.toContain("thread/resume");

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");

    await view.surface.focusThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("replaces active thread-scoped state when late workspace state restores another thread", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");
    view.surface.setComposerText("stale draft");

    await view.setState({ threadId: "thread-2", threadTitle: "Restored thread 2" }, {} as never);

    expect(view.getDisplayText()).toBe("Codex: Restored thread 2");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread 2" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({
      threadId: "thread-2",
      turnLifecycle: { kind: "idle" },
      hasComposerDraft: false,
    });
    expect(composerElement(view).value).toBe("");
  });

  it("warms app-server metadata for an empty restored panel after the shell is open", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")], nextCursor: null }),
    });
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMock.state.client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await view.onOpen();

    expect(connectionMock.state.connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMock.state.connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expect(fetchModels).toHaveBeenCalledOnce();
    expectRequestTimes(client, "skills/list", 1);
    expectRequestTimes(client, "permissionProfile/list", 1);
    expectRequestTimes(client, "account/rateLimits/read", 1);
    expect(client.request).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault",
      archived: false,
      limit: 100,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
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
              availableSkills: [{ name: "writer", enabled: true }],
              availablePermissionProfiles: [],
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

    expect(requestMethods(client)).not.toContain("thread/resume");
    await view.surface.focusThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("starts fresh hydration when the same restored view state is reapplied", async () => {
    const resume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn(() => resume.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();
    const firstHydration = view.surface.focusThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/resume", 1);
    });

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    const secondHydration = view.surface.focusThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/resume", 2);
    });

    resume.resolve(resumedThread("thread-1"));
    await Promise.all([firstHydration, secondHydration]);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
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
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(client.request).toHaveBeenCalledWith("turn/start", {
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "hello", text_elements: [] }],
        clientUserMessageId: expect.stringMatching(/^local-user-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
      });
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnLifecycle: { kind: "starting" } });
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    connectionMock.state.onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "inProgress",
          startedAt: 1,
          completedAt: null,
          durationMs: null,
          error: null,
          itemsView: "full",
          items: [],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnLifecycle: { kind: "running", turnId: "turn-1" } });
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

    expect(requestMethods(client)).not.toContain("thread/start");
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, turnLifecycle: { kind: "idle" }, hasComposerDraft: false });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("restores an unavailable side-chat tab as a normal empty chat", async () => {
    const view = await chatView();
    await view.setState({ version: 2, ephemeralSource: { threadId: "source", title: "Source" } }, {} as never);

    expect(view.getState()).toEqual({ version: 1 });
    expect(view.getDisplayText()).not.toBe("Side chat");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, turnLifecycle: { kind: "idle" }, hasComposerDraft: false });
    expect(view.containerEl.textContent).not.toContain("This side conversation is no longer available.");
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

  it("does not use restored thread identity as a composer name before the thread becomes active", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-1", threadTitle: "Restored title" }, {} as never);
    await view.onOpen();

    expect(composerPlaceholder(view)).toBe("Ask Codex...");

    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Explicit name" })]);
    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex...");
    });

    view.surface.applyThreadRenamed("thread-1", "Explicit name");

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex...");
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

    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Renamed thread" })]);
    view.surface.applyThreadRenamed("thread-1", "Renamed thread");

    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
      expect(composer.selectionStart).toBe(5);
      expect(composer.selectionEnd).toBe(9);
      expect(composer.getAttribute("placeholder")).toBe("Ask Codex in “Renamed thread”...");
    });
  });

  it("renders resumed thread metadata before history hydration completes", async () => {
    const history = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      "thread/turns/list": vi.fn(() => history.promise),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const opening = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
      );
    });

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).not.toContain("Loading thread...");

    history.resolve({ data: [], nextCursor: null });
    await opening;
  });

  it("hydrates resumed threads from the initial turns page without a second history request", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue({
        ...resumedThread("thread-1"),
        initialTurnsPage: {
          data: [completedTurn("turn-1")],
          nextCursor: "older-cursor",
          backwardsCursor: null,
        },
      }),
      "thread/turns/list": vi.fn().mockResolvedValue({ data: [turnWithUserMessage("fallback prompt")], nextCursor: null }),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(requestMethods(client)).not.toContain("thread/turns/list");
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("hello");
      expect(view.containerEl.textContent).toContain("done");
    });
  });

  it("ignores stale resume results when another thread is opened first", async () => {
    const firstResume = deferred<ReturnType<typeof resumedThread>>();
    const secondResume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) =>
        (params as { threadId: string }).threadId === "thread-1" ? firstResume.promise : secondResume.promise,
      ),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstOpen = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    });
    const secondOpen = view.surface.openThread("thread-2");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-2", cwd: "/vault" }));
    });

    secondResume.resolve(resumedThread("thread-2"));
    await secondOpen;
    firstResume.resolve(resumedThread("thread-1"));
    await firstOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expectRequestTimes(client, "thread/turns/list", 1);
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-2", cursor: null, limit: 20 }),
    );
  });

  it("invalidates stale history hydration when a second resume starts", async () => {
    const firstHistory = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
      "thread/turns/list": vi.fn((params: unknown) =>
        (params as { threadId: string }).threadId === "thread-1" ? firstHistory.promise : Promise.resolve({ data: [], nextCursor: null }),
      ),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const firstOpen = view.surface.openThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
      );
    });
    const secondOpen = view.surface.openThread("thread-2");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-2", cursor: null, limit: 20 }),
      );
    });

    firstHistory.resolve({ data: [turnWithUserMessage("first prompt")], nextCursor: null });
    await firstOpen;
    await secondOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).not.toContain("first prompt");
  });
});

type RequestHandler = ReturnType<typeof vi.fn<(params?: unknown, options?: unknown) => unknown>>;
type RequestSpy = ReturnType<typeof vi.fn<(method: string, params?: unknown, options?: unknown) => unknown>>;
type RequestHandlers = Record<string, RequestHandler>;
type TestAppServerClient = {
  requestHandlers: RequestHandlers;
  request: RequestSpy;
};

function connectedClient(overrides: RequestHandlers = {}): TestAppServerClient {
  return requestClient({ ...baseClientHandlers(), ...overrides });
}

function baseClientHandlers(): RequestHandlers {
  return {
    "config/read": vi.fn().mockResolvedValue({}),
    "model/list": vi.fn().mockResolvedValue({ data: [] }),
    "skills/list": vi.fn().mockResolvedValue({ data: [] }),
    "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: null }),
    "thread/list": vi.fn().mockResolvedValue({ data: [] }),
    "thread/start": vi.fn().mockResolvedValue(startedThread("thread-new")),
    "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-1")),
    "thread/turns/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "turn/start": vi.fn().mockResolvedValue({ turn: { id: "turn-1" } }),
    "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("thread-forked") }),
    "thread/rollback": vi.fn().mockResolvedValue({ thread: threadFixture("thread-forked") }),
    "thread/name/set": vi.fn().mockResolvedValue({}),
    "thread/goal/get": vi.fn().mockResolvedValue({ goal: null }),
    "thread/goal/set": vi.fn().mockResolvedValue({ goal: goalFixture("thread-1") }),
    "thread/inject_items": vi.fn().mockResolvedValue({}),
    "thread/read": vi.fn().mockResolvedValue({ thread: threadFixture("thread-1") }),
    "thread/archive": vi.fn().mockResolvedValue({}),
  };
}

function requestClient(handlers: RequestHandlers): TestAppServerClient {
  return {
    requestHandlers: handlers,
    request: vi.fn((method: string, params: unknown, options?: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params, options);
    }),
  };
}

function requestMethods(client: TestAppServerClient): string[] {
  return client.request.mock.calls.map(([method]) => method);
}

function expectRequestTimes(client: TestAppServerClient, method: string, times: number): void {
  expect(requestMethods(client).filter((calledMethod) => calledMethod === method)).toHaveLength(times);
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
    provenance: { kind: "interactive" },
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
    provenance: { kind: "interactive" },
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

function mockThreadStreamViewportOffsetMetrics(metrics: { clientHeight: number; clientWidth: number }): () => void {
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__thread-stream") ? metrics.clientHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__thread-stream") ? metrics.clientWidth : 0;
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
  settings?: Partial<CodexPanelSettings>;
  vaultPath?: string;
  openThreadInNewView?: CodexChatHost["workspace"]["openThreadInNewView"];
  focusThreadInOpenView?: CodexChatHost["workspace"]["focusThreadInOpenView"];
  openTurnDiff?: CodexChatHost["workspace"]["openTurnDiff"];
  refreshThreadsViewLiveState?: CodexChatHost["workspace"]["refreshThreadsViewLiveState"];
  openSideChat?: CodexChatHost["workspace"]["openSideChat"];
  applyThreadCatalogEvent?: CodexChatHost["threadCatalog"]["apply"];
  refreshActive?: CodexChatHost["threadCatalog"]["refreshActive"];
  activeSnapshot?: CodexChatHost["threadCatalog"]["activeSnapshot"];
  appServerMetadataSnapshot?: CodexChatHost["appServerQueries"]["appServerMetadataSnapshot"];
  modelsSnapshot?: CodexChatHost["appServerQueries"]["modelsSnapshot"];
  fetchModels?: CodexChatHost["appServerQueries"]["fetchModels"];
  refreshModels?: CodexChatHost["appServerQueries"]["refreshModels"];
  refreshAppServerMetadata?: CodexChatHost["appServerQueries"]["refreshAppServerMetadata"];
  refreshSkills?: CodexChatHost["appServerQueries"]["refreshSkills"];
  refreshRateLimits?: CodexChatHost["appServerQueries"]["refreshRateLimits"];
}

function chatHost(overrides: ChatHostFixtureOverrides = {}): TestCodexChatHost {
  let activeThreads = overrides.activeSnapshot?.() ?? null;
  let metadata = overrides.appServerMetadataSnapshot?.() ?? null;
  let models = overrides.modelsSnapshot?.() ?? null;
  const activeThreadResultListeners = new Set<(result: ObservedResult<readonly Thread[]>) => void>();
  const metadataResultListeners = new Set<(result: ObservedResult<SharedServerMetadata>) => void>();
  const modelResultListeners = new Set<(result: ObservedResult<readonly ModelMetadata[]>) => void>();
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
    return nextMetadata;
  };
  const loadAppServerMetadata = async (reloadSkills = false): Promise<SharedServerMetadata | null> => {
    const client = connectionMock.state.client as TestAppServerClient | null;
    if (!client || !connectionMock.state.connected) return null;
    const connectionStillCurrent = () => connectionMock.state.client === client && connectionMock.state.connected;
    await client.request("config/read", { cwd: vaultPath, includeLayers: true });
    if (!connectionStillCurrent()) return null;
    let fetchedModels: readonly ModelMetadata[];
    if (overrides.fetchModels) {
      fetchedModels = await overrides.fetchModels();
    } else {
      const modelsResponse = (await client.request("model/list", { includeHidden: false, limit: 100 })) as {
        data: Parameters<typeof modelMetadataFromCatalogModels>[0];
      };
      fetchedModels = modelMetadataFromCatalogModels(modelsResponse.data);
    }
    if (!connectionStillCurrent()) return null;
    models = fetchedModels;
    for (const listener of modelResultListeners) listener(queryResult(fetchedModels));
    const skillsResponse = (await client.request("skills/list", { cwds: [vaultPath], forceReload: reloadSkills })) as {
      data: { skills: { name: string; description?: string; path?: string; enabled?: boolean }[] }[];
    };
    if (!connectionStillCurrent()) return null;
    const permissionProfilesResponse = (await client.request("permissionProfile/list", { cwd: vaultPath, cursor: null, limit: 100 })) as {
      data: { id: string; description: string | null; allowed: boolean }[];
      nextCursor: string | null;
    };
    if (!connectionStillCurrent()) return null;
    await client.request("account/rateLimits/read", undefined);
    if (!connectionStillCurrent()) return null;
    return {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableSkills: skillsResponse.data.flatMap(
        (entry: { skills: { name: string; description?: string; path?: string; enabled?: boolean }[] }) =>
          entry.skills.map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            path: skill.path ?? "",
            enabled: skill.enabled ?? true,
          })),
      ),
      availablePermissionProfiles: permissionProfilesResponse.data.map((profile) => ({ ...profile })),
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
      case "thread-unarchived":
        return;
    }
  };
  return {
    settingsSource: settings,
    receiveActiveThreads: (threads) => {
      activeThreads = threads;
      emitActiveThreads();
    },
    threadNameMutations: createThreadNameMutationCoordinator(),
    settingsRef: {
      settings: chatPanelSettingsAccess(settings),
      vaultPath,
    },
    workspace: {
      openThreadInNewView: overrides.openThreadInNewView ?? vi.fn(),
      focusThreadInOpenView: overrides.focusThreadInOpenView ?? vi.fn().mockResolvedValue(false),
      openTurnDiff: overrides.openTurnDiff ?? vi.fn(),
      refreshThreadsViewLiveState: overrides.refreshThreadsViewLiveState ?? vi.fn(),
      openSideChat: overrides.openSideChat ?? vi.fn().mockResolvedValue(undefined),
    },
    appServerQueries: {
      contextLease: () => ({ context: { codexPath: settings.codexPath, vaultPath }, generation: 1 }),
      appServerMetadataSnapshot: overrides.appServerMetadataSnapshot ?? vi.fn(() => metadata),
      refreshAppServerMetadata:
        overrides.refreshAppServerMetadata ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata();
          return nextMetadata ? applyMetadataToCache(nextMetadata) : null;
        }),
      refreshSkills:
        overrides.refreshSkills ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata(true);
          return nextMetadata ? applyMetadataToCache(nextMetadata) : null;
        }),
      refreshRateLimits:
        overrides.refreshRateLimits ??
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
      applyConnectionEvent: (_context, event) => (overrides.applyThreadCatalogEvent ?? applyThreadCatalogEvent)(event),
      refreshActive:
        overrides.refreshActive ??
        (vi.fn(async () => {
          const client = connectionMock.state.client;
          if (!client) return activeThreads ?? [];
          const request = client["request"] as (method: string, params: Record<string, unknown>) => Promise<{ data: ThreadRecord[] }>;
          const response = await request("thread/list", {
            cwd: "/vault",
            archived: false,
            limit: 100,
            sortKey: "recency_at",
            sortDirection: "desc",
          });
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

function queryResult<T>(value: T | null): ObservedResult<T> {
  return {
    value,
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
