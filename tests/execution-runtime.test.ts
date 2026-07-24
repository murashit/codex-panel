import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexExecutionRuntime } from "../src/execution-runtime";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import type { ThreadPickerController } from "../src/features/thread-picker/modal.obsidian";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import { StaleExecutionRuntimeError } from "../src/shared/runtime/execution-runtime-lifetime";

const { openThreadPickerMock, withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  openThreadPickerMock: vi.fn(),
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../src/features/thread-picker/modal.obsidian", () => ({
  openThreadPicker: openThreadPickerMock,
}));

vi.mock("../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

describe("CodexExecutionRuntime", () => {
  beforeEach(() => {
    openThreadPickerMock.mockReset();
    withShortLivedAppServerClientMock.mockReset();
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
    await expect(fetch).rejects.toBeInstanceOf(StaleExecutionRuntimeError);
  });

  it("classifies a rejected short-lived operation as stale when disposed in flight", async () => {
    let rejectOperation: (error: Error) => void = () => undefined;
    const operation = new Promise<never>((_resolve, reject) => {
      rejectOperation = reject;
    });
    withShortLivedAppServerClientMock.mockReturnValue(operation);
    const runtime = executionRuntime();

    const request = attachChatHost(runtime).appServerClientAccess.withClient(() => Promise.resolve("unused"));
    runtime.dispose();
    rejectOperation(new Error("Disconnected"));

    await expect(request).rejects.toBeInstanceOf(StaleExecutionRuntimeError);
  });
});

function attachChatHost(runtime: CodexExecutionRuntime): CodexChatHost {
  let host: CodexChatHost | null = null;
  const view: ChatRuntimeView = {
    attachRuntime: (nextHost) => {
      host = nextHost;
    },
    detachRuntime: vi.fn(),
    activateRuntime: vi.fn(),
  };
  runtime.attachChatView(view);
  if (!host) throw new Error("Runtime did not attach a chat host");
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

function executionRuntime(): CodexExecutionRuntime {
  return new CodexExecutionRuntime({
    app: {} as never,
    context: { codexPath: "codex", vaultPath: "/vault" },
    settings: () => ({ ...DEFAULT_SETTINGS }),
    workspace: {} as never,
    onThreadFacts: vi.fn(),
    openNewPanel: vi.fn(),
    openThreadInCurrentView: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openPanelActivities: () => [],
  });
}
