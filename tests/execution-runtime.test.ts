import { threadGoalFixture } from "./support/thread-goal";
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../manifest.json";
import compatibility from "../src/app-server/compatibility.json";
import { AppServerClient } from "../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../src/app-server/connection/connection-manager";
import * as contextConnection from "../src/app-server/connection/context-connection";
import { CodexExecutionRuntime } from "../src/execution-runtime";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import type { ThreadPickerController } from "../src/features/thread-picker/modal.obsidian";
import * as threadPicker from "../src/features/thread-picker/modal.obsidian";
import type { ThreadsViewHost } from "../src/features/threads-view/session";
import type { ThreadsRuntimeView } from "../src/features/threads-view/view.obsidian";
import type { RateLimitSnapshot } from "../src/generated/app-server/v2/RateLimitSnapshot";
import { DEFAULT_SETTINGS } from "../src/settings/preferences";

const ActualContextConnection = contextConnection.AppServerContextConnection;
const rateLimitSnapshot = {
  limitId: "codex",
  limitName: "Codex",
  normalModelSlug: null,
  primary: null,
  secondary: null,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
} satisfies RateLimitSnapshot;
const contextConnectionMock = {
  client: { disconnect: vi.fn(), request: vi.fn() },
  instances: [] as Array<{
    initializeParams: unknown;
    handlers: ConnectionManagerHandlers | null;
  }>,
};
const openThreadPickerMock = vi.fn();

describe("CodexExecutionRuntime", () => {
  beforeEach(() => {
    vi.spyOn(threadPicker, "openThreadPicker").mockImplementation(openThreadPickerMock);
    vi.spyOn(contextConnection, "AppServerContextConnection").mockImplementation(
      class extends ActualContextConnection {
        constructor(...args: ConstructorParameters<typeof ActualContextConnection>) {
          const record = { initializeParams: args[2], handlers: null as ConnectionManagerHandlers | null };
          super(args[0], args[1], args[2], args[3], {
            connect: async (handlers) => {
              record.handlers = handlers;
              return { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
            },
            currentClient: () => contextConnectionMock.client as unknown as AppServerClient,
            disconnect: contextConnectionMock.client.disconnect,
          });
          contextConnectionMock.instances.push(record);
        }
      },
    );
    openThreadPickerMock.mockReset();
    contextConnectionMock.client.disconnect.mockReset();
    contextConnectionMock.client.request.mockReset();
    contextConnectionMock.instances.length = 0;
  });

  afterEach(() => vi.restoreAllMocks());

  describe("thread picker ownership", () => {
    it("replaces the active picker and disposes only the current picker", () => {
      const pickers = pickerFactory();
      const runtime = executionRuntime();

      runtime.openThreadPicker();
      runtime.openThreadPicker();

      expect(pickers.controllers[0]?.close).toHaveBeenCalledOnce();
      expect(pickers.controllers[1]?.close).not.toHaveBeenCalled();

      runtime.dispose();

      expect(pickers.controllers[0]?.close).toHaveBeenCalledOnce();
      expect(pickers.controllers[1]?.close).toHaveBeenCalledOnce();
    });

    it("releases a naturally closed picker before runtime disposal", () => {
      const pickers = pickerFactory();
      const runtime = executionRuntime();

      runtime.openThreadPicker();
      pickers.finish[0]?.();
      runtime.dispose();

      expect(pickers.controllers[0]?.close).not.toHaveBeenCalled();
    });
  });

  it("shares one thread mutation owner across attached surfaces", () => {
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);
    const threads = attachThreadsHost(runtime);

    expect(chat.threadMutations).toBe(threads.threadMutations);
  });

  it("stops publishing thread facts after disposal", () => {
    const onThreadFacts = vi.fn();
    const runtime = executionRuntime(onThreadFacts);
    const facts = attachChatHost(runtime).threadFacts;

    facts.apply({ type: "thread-archived", threadId: "before-dispose" });
    runtime.dispose();
    facts.apply({ type: "thread-archived", threadId: "after-dispose" });

    expect(onThreadFacts).toHaveBeenCalledExactlyOnceWith([{ type: "thread-archived", threadId: "before-dispose" }]);
  });

  it("uses one context connection for shared reads and panel sessions", async () => {
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);

    const first = await runtime.appServerConnection.withClient(async (client) => client);

    expect(first).toBe(contextConnectionMock.client);
    expect(chat.appServerConnection).toBe(runtime.appServerConnection);
    expect(contextConnectionMock.instances).toHaveLength(1);
    expect(contextConnectionMock.instances[0]?.initializeParams).toEqual({
      clientInfo: { name: "obsidian_codex_panel", title: "Codex Panel", version: manifest.version },
      capabilities: compatibility.codexAppServer.initialize.capabilities,
    });
  });

  it("routes read-only queries and archive through the panel context client", async () => {
    vi.when(contextConnectionMock.client.request, { onUnmatched: "throw" })
      .calledWith("model/list", { cursor: null, includeHidden: false, limit: 100 })
      .thenResolve({ data: [] })
      .calledWith("thread/archive", { threadId: "thread" })
      .thenResolve({});
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);

    await runtime.settingsResources.queries.fetchModels();
    await chat.threadMutations.archiveThread("thread", { saveMarkdown: false });

    expect(contextConnectionMock.client.request).toHaveBeenCalledWith("model/list", { cursor: null, includeHidden: false, limit: 100 });
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
    expect(contextConnectionMock.instances).toHaveLength(1);
  });

  it("publishes descendant lifecycle notifications once from the context owner", async () => {
    const onThreadFacts = vi.fn();
    await executionRuntime(onThreadFacts).appServerConnection.withClient(async () => undefined);

    contextHandlers().onNotification({
      method: "thread/archived",
      params: { threadId: "descendant" },
    });

    expect(onThreadFacts).toHaveBeenCalledExactlyOnceWith([{ type: "thread-archived", threadId: "descendant" }]);
  });

  it("reuses hydrated metadata across chat panels in one execution context", async () => {
    mockMetadataRequests();
    const runtime = executionRuntime();
    const first = attachChatHost(runtime);
    const second = attachChatHost(runtime);

    await first.appServerQueries.ensureAppServerMetadata();
    const hydratedRequestCount = contextConnectionMock.client.request.mock.calls.length;
    await second.appServerQueries.ensureAppServerMetadata();

    expect(hydratedRequestCount).toBeGreaterThan(0);
    expect(contextConnectionMock.client.request.mock.calls.slice(hydratedRequestCount)).toEqual([]);
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith("skills/list", { cwds: ["/vault"], forceReload: false });
  });

  it("owns tool inventory and its notification revalidation once per execution context", async () => {
    mockToolInventoryRequests();
    const runtime = executionRuntime();
    const first = attachChatHost(runtime);
    const second = attachChatHost(runtime);

    const unsubscribeFirst = first.toolInventoryQueries.observe("thread", () => undefined);
    const unsubscribeSecond = second.toolInventoryQueries.observe("thread", () => undefined);
    await first.toolInventoryQueries.ensure("thread");
    expect(contextConnectionMock.client.request).toHaveBeenCalledTimes(2);
    contextConnectionMock.client.request.mockClear();

    contextHandlers().onNotification({
      method: "mcpServer/oauthLogin/completed",
      params: { name: "github", threadId: "thread", success: true },
    });

    await vi.waitFor(() => expect(contextConnectionMock.client.request).toHaveBeenCalledOnce());
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith(
      "mcpServerStatus/list",
      expect.objectContaining({ threadId: "thread" }),
    );
    contextHandlers().onNotification({
      method: "mcpServer/startupStatus/updated",
      params: {
        threadId: "thread",
        name: "github",
        status: "failed",
        error: "missing token",
        failureReason: "reauthenticationRequired",
      },
    });
    await vi.waitFor(() => {
      expect(first.toolInventoryQueries.snapshot("thread")?.mcpDiagnostics).toMatchObject([
        { name: "github", connectionStatus: "failed", message: "missing token" },
      ]);
      expect(second.toolInventoryQueries.snapshot("thread")?.mcpDiagnostics).toMatchObject([
        { name: "github", connectionStatus: "failed", message: "missing token" },
      ]);
    });
    contextConnectionMock.client.request.mockClear();
    contextHandlers().onNotification({ method: "app/list/updated", params: { data: [] } });
    await vi.waitFor(() => expect(contextConnectionMock.client.request).toHaveBeenCalledOnce());
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith(
      "mcpServerStatus/list",
      expect.objectContaining({ threadId: "thread" }),
    );
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("updates thread goal cache even when no panel lease receives the notification", async () => {
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);
    await runtime.appServerConnection.withClient(async () => undefined);
    const previous = threadGoalFixture({ objective: "Old" });
    const next = threadGoalFixture({ objective: "Latest" });
    contextHandlers().onNotification({
      method: "thread/goal/updated",
      params: { threadId: "thread", turnId: null, goal: { ...previous, createdAt: 1, updatedAt: 1 } },
    });

    contextHandlers().onNotification({
      method: "thread/goal/updated",
      params: { threadId: "thread", turnId: null, goal: { ...next, createdAt: 1, updatedAt: 1 } },
    });

    expect(chat.threadGoalQueries.snapshot("thread")).toEqual(next);
  });

  it.each([
    { notification: { method: "skills/changed", params: {} }, requestMethod: "skills/list" },
    {
      notification: { method: "account/rateLimits/updated", params: { rateLimits: rateLimitSnapshot } },
      requestMethod: "account/rateLimits/read",
    },
  ] as const)("revalidates used shared metadata once for $notification.method", async ({ notification, requestMethod }) => {
    mockMetadataRequests();
    const runtime = executionRuntime();
    const queries = attachChatHost(runtime).appServerQueries;
    attachChatHost(runtime);
    await queries.ensureAppServerMetadata();
    contextConnectionMock.client.request.mockClear();

    contextHandlers().onNotification(notification);

    await vi.waitFor(() => expect(contextConnectionMock.client.request).toHaveBeenCalledOnce());
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith(
      requestMethod,
      requestMethod === "skills/list" ? { cwds: ["/vault"], forceReload: false } : undefined,
    );
  });

  it("does not fetch metadata solely because an unused resource notification arrived", async () => {
    mockMetadataRequests();
    await executionRuntime().appServerConnection.withClient(async () => undefined);

    contextHandlers().onNotification({ method: "skills/changed", params: {} });
    await Promise.resolve();

    expect(contextConnectionMock.client.request).not.toHaveBeenCalled();
  });

  it("invalidates context queries when the app-server process exits", async () => {
    mockMetadataRequests();
    const queries = attachChatHost(executionRuntime()).appServerQueries;
    await queries.ensureAppServerMetadata();
    const hydratedRequestCount = contextConnectionMock.client.request.mock.calls.length;

    contextHandlers().onExit();
    await queries.ensureAppServerMetadata();

    expect(contextConnectionMock.client.request.mock.calls.length).toBeGreaterThan(hydratedRequestCount);
    expect(contextConnectionMock.client.request.mock.calls.slice(hydratedRequestCount).map(([method]) => method)).toContain("config/read");
    expect(contextConnectionMock.client.request.mock.calls.slice(hydratedRequestCount).map(([method]) => method)).toContain("skills/list");
  });

  it("disconnects the shared context connection on disposal", () => {
    const runtime = executionRuntime();

    runtime.dispose();
    runtime.dispose();

    expect(contextConnectionMock.client.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    { stage: "connect", cancellation: "runtime" },
    { stage: "thread/start", cancellation: "runtime" },
    { stage: "turn/start", cancellation: "runtime" },
    { stage: "completion", cancellation: "runtime" },
    { stage: "completion", cancellation: "caller" },
  ] as const)(
    "disconnects a private structured-turn client on $cancellation cancellation during $stage",
    async ({ stage, cancellation }) => {
      const reached = vi.fn();
      vi.spyOn(AppServerClient.prototype, "connect").mockImplementation(() => {
        if (stage === "connect") {
          reached();
          return new Promise(() => undefined);
        }
        return Promise.resolve({} as never);
      });
      vi.spyOn(AppServerClient.prototype, "request").mockImplementation(async (method) => {
        if (method === stage) {
          reached();
          return new Promise(() => undefined);
        }
        if (method === "config/read") return { config: {} } as never;
        if (method === "thread/start") return { thread: { id: "helper" } } as never;
        if (method === "turn/start") {
          reached();
          return { turn: { id: "turn", status: "inProgress", items: [] } } as never;
        }
        throw new Error(`Unexpected request: ${method}`);
      });
      const disconnect = vi.spyOn(AppServerClient.prototype, "disconnect").mockImplementation(() => undefined);
      const runtime = executionRuntime();
      const port = runtime.selectionRewritePort();
      const controller = new AbortController();
      const options = {
        prompt: "Rewrite this.",
        runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
        onActivity: vi.fn(),
        onPreview: vi.fn(),
        signal: controller.signal,
      };
      const request = port.generate(options);
      await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());

      if (cancellation === "caller") controller.abort();
      else runtime.dispose();

      await expect(request).rejects.toThrow("Selection rewrite cancelled.");
      expect(disconnect).toHaveBeenCalledOnce();
      runtime.dispose();
      await expect(port.generate(options)).rejects.toThrow("Codex execution runtime is no longer active.");
      expect(disconnect).toHaveBeenCalledOnce();
    },
  );
});

function attachChatHost(runtime: CodexExecutionRuntime): CodexChatHost {
  let host: CodexChatHost | null = null;
  const view: ChatRuntimeView = {
    attachRuntime: (nextHost) => {
      host = nextHost;
    },
    detachRuntime: vi.fn().mockResolvedValue(undefined),
  };
  runtime.attachChatView(view);
  if (!host) throw new Error("Runtime did not attach a chat host");
  return host;
}

function attachThreadsHost(runtime: CodexExecutionRuntime): ThreadsViewHost {
  let host: ThreadsViewHost | null = null;
  const view: ThreadsRuntimeView = {
    attachRuntime: (nextHost) => {
      host = nextHost;
    },
    detachRuntime: vi.fn(),
  };
  runtime.attachThreadsView(view);
  if (!host) throw new Error("Runtime did not attach a threads host");
  return host;
}

function pickerFactory(): {
  controllers: Array<ThreadPickerController & { close: ReturnType<typeof vi.fn> }>;
  finish: Array<() => void>;
} {
  const controllers: Array<ThreadPickerController & { close: ReturnType<typeof vi.fn> }> = [];
  const finish: Array<() => void> = [];
  openThreadPickerMock.mockImplementation((_host: unknown, onClosed: () => void) => {
    const controller = {
      close: vi.fn(() => {
        onClosed();
      }),
    };
    controllers.push(controller);
    finish.push(onClosed);
    return controller;
  });
  return { controllers, finish };
}

function executionRuntime(onThreadFacts = vi.fn()): CodexExecutionRuntime {
  return new CodexExecutionRuntime({
    app: { vault: { configDir: ".obsidian" } } as never,
    context: { codexPath: "codex", vaultPath: "/vault" },
    settings: () => ({ ...DEFAULT_SETTINGS }),
    workspace: { openPanelActivities: () => [] } as never,
    onThreadFacts,
  });
}

function mockMetadataRequests(): void {
  vi.when(contextConnectionMock.client.request, { onUnmatched: "throw" })
    .calledWith("config/read", expect.anything())
    .thenResolve({})
    .calledWith("model/list", expect.anything())
    .thenResolve({ data: [] })
    .calledWith("skills/list", expect.anything())
    .thenResolve({ data: [{ skills: [] }] })
    .calledWith("permissionProfile/list", expect.anything())
    .thenResolve({ data: [], nextCursor: null })
    .calledWith("account/rateLimits/read", undefined)
    .thenResolve({
      rateLimits: rateLimitSnapshot,
      rateLimitsByLimitId: null,
    });
}

function mockToolInventoryRequests(): void {
  vi.when(contextConnectionMock.client.request, { onUnmatched: "throw" })
    .calledWith("plugin/installed", expect.anything())
    .thenResolve({ marketplaces: [], marketplaceLoadErrors: [] })
    .calledWith("mcpServerStatus/list", expect.anything())
    .thenResolve({ data: [], nextCursor: null });
}

function contextHandlers(): ConnectionManagerHandlers {
  const handlers = contextConnectionMock.instances[0]?.handlers;
  if (!handlers) throw new Error("Expected a connected context manager.");
  return handlers;
}
