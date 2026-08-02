import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexExecutionRuntime } from "../src/execution-runtime";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import type { ThreadPickerController } from "../src/features/thread-picker/modal.obsidian";
import type { ThreadsViewHost } from "../src/features/threads-view/session";
import type { ThreadsRuntimeView } from "../src/features/threads-view/view.obsidian";
import { DEFAULT_SETTINGS } from "../src/settings/model";

const { openThreadPickerMock, withShortLivedAppServerClientMock, runEphemeralStructuredTurnMock } = vi.hoisted(() => ({
  openThreadPickerMock: vi.fn(),
  withShortLivedAppServerClientMock: vi.fn(),
  runEphemeralStructuredTurnMock: vi.fn(),
}));

vi.mock("../src/features/thread-picker/modal.obsidian", () => ({
  openThreadPicker: openThreadPickerMock,
}));

vi.mock("../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

vi.mock("../src/app-server/services/ephemeral-structured-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/app-server/services/ephemeral-structured-turn")>()),
  runEphemeralStructuredTurn: runEphemeralStructuredTurnMock,
}));

describe("CodexExecutionRuntime", () => {
  beforeEach(() => {
    openThreadPickerMock.mockReset();
    withShortLivedAppServerClientMock.mockReset();
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

  it("disconnects an active query client and rejects its late completion when disposed", async () => {
    let resolveModels: (value: { data: readonly [] }) => void = () => undefined;
    const models = new Promise<{ data: readonly [] }>((resolve) => {
      resolveModels = resolve;
    });
    const client = {
      disconnect: vi.fn(),
      request: vi.fn(() => models),
    };
    withShortLivedAppServerClientMock.mockImplementation(
      async (
        _codexPath: string,
        _vaultPath: string,
        operation: (appServerClient: typeof client) => Promise<unknown>,
        _options: unknown,
        lifetime: { created(appServerClient: typeof client): void; disposed(appServerClient: typeof client): void },
      ) => {
        lifetime.created(client);
        try {
          return await operation(client);
        } finally {
          lifetime.disposed(client);
        }
      },
    );
    const runtime = executionRuntime();

    const fetch = attachChatHost(runtime).appServerQueries.fetchModels();
    await Promise.resolve();
    runtime.dispose();

    expect(client.disconnect).toHaveBeenCalledOnce();
    resolveModels({ data: [] });
    await fetch.catch(() => undefined);
  });

  it("preserves a rejected short-lived operation after disposal", async () => {
    let rejectOperation: (error: Error) => void = () => undefined;
    const operation = new Promise<never>((_resolve, reject) => {
      rejectOperation = reject;
    });
    withShortLivedAppServerClientMock.mockReturnValue(operation);
    const runtime = executionRuntime();

    const request = attachChatHost(runtime).appServerClientAccess.withClient(() => Promise.resolve("unused"));
    runtime.dispose();
    rejectOperation(new Error("Disconnected"));

    await expect(request).rejects.toThrow("Disconnected");
  });

  it("disconnects a client created after the runtime is disposed", async () => {
    let runtime!: CodexExecutionRuntime;
    const client = { disconnect: vi.fn(), request: vi.fn() };
    withShortLivedAppServerClientMock.mockImplementation(
      async (
        _codexPath: string,
        _vaultPath: string,
        _operation: unknown,
        _options: unknown,
        lifecycle: { created(appServerClient: typeof client): void },
      ) => {
        runtime.dispose();
        lifecycle.created(client);
      },
    );
    runtime = executionRuntime();

    await expect(runtime.withClient(() => Promise.resolve("unused"))).rejects.toThrow("Codex execution runtime is no longer active.");

    expect(client.disconnect).toHaveBeenCalledOnce();
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
    workspace: {} as never,
    onThreadFacts,
    openNewPanel: vi.fn(),
    openThreadInCurrentView: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openPanelActivities: () => [],
  });
}
