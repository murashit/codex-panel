import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexExecutionRuntime } from "../src/execution-runtime";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import type { ThreadPickerController } from "../src/features/thread-picker/modal.obsidian";
import type { ThreadsViewHost } from "../src/features/threads-view/session";
import type { ThreadsRuntimeView } from "../src/features/threads-view/view.obsidian";
import { DEFAULT_SETTINGS } from "../src/settings/model";

const { contextConnectionMock, openThreadPickerMock, runEphemeralStructuredTurnMock } = vi.hoisted(() => ({
  contextConnectionMock: {
    client: { disconnect: vi.fn(), request: vi.fn() },
    instances: [] as Array<{
      dispose: ReturnType<typeof vi.fn>;
      handlers: { onNotification(notification: unknown): void };
    }>,
  },
  openThreadPickerMock: vi.fn(),
  runEphemeralStructuredTurnMock: vi.fn(),
}));

vi.mock("../src/features/thread-picker/modal.obsidian", () => ({
  openThreadPicker: openThreadPickerMock,
}));

vi.mock("../src/app-server/connection/context-connection", () => ({
  AppServerContextConnection: class {
    readonly dispose = vi.fn(() => {
      contextConnectionMock.client.disconnect();
    });

    constructor(
      _codexPath: string,
      _cwd: string,
      _initializeParams: unknown,
      readonly handlers: { onNotification(notification: unknown): void },
    ) {
      contextConnectionMock.instances.push(this);
    }

    createLease() {
      return {
        connect: vi.fn(),
        currentClient: () => contextConnectionMock.client,
        isConnected: () => true,
        disconnect: vi.fn(),
      };
    }

    withClient<T>(operation: (client: typeof contextConnectionMock.client) => Promise<T>): Promise<T> {
      return operation(contextConnectionMock.client);
    }

    currentClient() {
      return contextConnectionMock.client;
    }

    isConnected() {
      return true;
    }
  },
}));

vi.mock("../src/app-server/services/ephemeral-structured-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/app-server/services/ephemeral-structured-turn")>()),
  runEphemeralStructuredTurn: runEphemeralStructuredTurnMock,
}));

describe("CodexExecutionRuntime", () => {
  beforeEach(() => {
    openThreadPickerMock.mockReset();
    contextConnectionMock.client.disconnect.mockReset();
    contextConnectionMock.client.request.mockReset();
    contextConnectionMock.instances.length = 0;
    runEphemeralStructuredTurnMock.mockReset();
  });

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

    expect(onThreadFacts).toHaveBeenCalledOnce();
    expect(onThreadFacts).toHaveBeenCalledWith([{ type: "thread-archived", threadId: "before-dispose" }]);
  });

  it("uses one context connection for shared reads and panel sessions", async () => {
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);

    const first = await runtime.withClient(async (client) => client);

    expect(first).toBe(contextConnectionMock.client);
    expect(chat.appServerConnection).toBe(runtime.appServerConnection);
    expect(contextConnectionMock.instances).toHaveLength(1);
  });

  it("routes read-only queries and archive through the panel context client", async () => {
    contextConnectionMock.client.request.mockImplementation(async (method: string) => {
      if (method === "model/list") return { data: [] };
      if (method === "thread/archive") return {};
      throw new Error(`Unexpected app-server request: ${method}`);
    });
    const runtime = executionRuntime();
    const chat = attachChatHost(runtime);

    await chat.appServerQueries.fetchModels();
    await chat.threadMutations.archiveThread("thread", { saveMarkdown: false });

    expect(contextConnectionMock.client.request).toHaveBeenCalledWith("model/list", { cursor: null, includeHidden: false, limit: 100 });
    expect(contextConnectionMock.client.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
    expect(contextConnectionMock.instances).toHaveLength(1);
  });

  it("publishes descendant lifecycle notifications once from the context owner", () => {
    const onThreadFacts = vi.fn();
    executionRuntime(onThreadFacts);

    contextConnectionMock.instances[0]?.handlers.onNotification({
      method: "thread/archived",
      params: { threadId: "descendant" },
    });

    expect(onThreadFacts).toHaveBeenCalledOnce();
    expect(onThreadFacts).toHaveBeenCalledWith([{ type: "thread-archived", threadId: "descendant" }]);
  });

  it("disconnects the shared context connection on disposal", () => {
    const runtime = executionRuntime();

    runtime.dispose();

    expect(contextConnectionMock.instances[0]?.dispose).toHaveBeenCalledOnce();
    expect(contextConnectionMock.client.disconnect).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight structured turn when the runtime is disposed", async () => {
    runEphemeralStructuredTurnMock.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new Error("structured turn aborted"));
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        }),
    );
    const runtime = executionRuntime();
    const request = runtime.selectionRewritePort().generate({
      prompt: "Rewrite this.",
      runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
      onActivity: vi.fn(),
      onPreview: vi.fn(),
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(runEphemeralStructuredTurnMock).toHaveBeenCalledOnce());

    runtime.dispose();

    await expect(request).rejects.toThrow("structured turn aborted");
    expect(runEphemeralStructuredTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ codexPath: "codex", cwd: "/vault", prompt: "Rewrite this." }),
      expect.anything(),
    );
  });
});

function attachChatHost(runtime: CodexExecutionRuntime): CodexChatHost {
  let host: CodexChatHost | null = null;
  const view: ChatRuntimeView = {
    attachRuntime: (nextHost) => {
      host = nextHost;
    },
    detachRuntime: vi.fn(),
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
