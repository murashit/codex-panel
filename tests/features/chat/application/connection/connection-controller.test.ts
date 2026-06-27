import { describe, expect, it, vi } from "vitest";

import { emptyRuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import {
  type ChatConnectionAdapter,
  type ChatConnectionControllerHost,
  type ChatConnectionDiagnosticsActions,
  type ChatConnectionMetadataActions,
  createChatConnectionController,
} from "../../../../../src/features/chat/application/connection/connection-controller";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ConnectionWorkTracker } from "../../../../../src/shared/lifecycle/connection-work";

function createController({ connected = false } = {}) {
  const stateStore = createChatStateStore(createChatState());
  let isConnected = connected;
  const connect = vi.fn().mockImplementation(async () => {
    isConnected = true;
    return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
  });
  const connection: ChatConnectionAdapter = {
    connect,
    isConnected: () => isConnected,
  };
  const refreshAppServerMetadata = vi.fn().mockResolvedValue(null);
  const refreshServerDiagnostics = vi.fn().mockResolvedValue(undefined);
  const metadata = {
    refreshAppServerMetadata,
  } satisfies ChatConnectionMetadataActions;
  const diagnostics = {
    refreshServerDiagnostics,
  } satisfies ChatConnectionDiagnosticsActions;
  const host: ChatConnectionControllerHost = {
    stateStore,
    connection,
    connectionWork: new ConnectionWorkTracker(),
    metadata,
    diagnostics,
    invalidateThreadWork: vi.fn(),
    refreshSharedThreads: vi.fn().mockResolvedValue(undefined),
    refreshTabHeader: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    configuredCommand: () => "codex",
    refreshLiveState: vi.fn(),
    isStaleConnectionError: () => false,
    isStaleSharedQueryError: () => false,
    notifyConnectionFailed: vi.fn(),
  };
  return {
    connect,
    controller: createChatConnectionController(host),
    host,
    refreshAppServerMetadata,
    refreshServerDiagnostics,
    stateStore,
  };
}

describe("ChatConnectionController", () => {
  it("connects once and publishes startup metadata", async () => {
    const { connect, controller, host, refreshAppServerMetadata, stateStore } = createController();

    await controller.ensureConnected();

    expect(connect).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.initializeResponse).toEqual({
      codexHome: "/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "test",
    });
    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
  });

  it("refreshes metadata before server diagnostics", async () => {
    const { controller, refreshAppServerMetadata, refreshServerDiagnostics } = createController({ connected: true });

    await controller.refreshDiagnostics();

    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(refreshServerDiagnostics).toHaveBeenCalledWith({ appServerMetadataSnapshot: true });
  });

  it("refreshes active threads without refreshing metadata", async () => {
    const { controller, host, refreshAppServerMetadata } = createController({ connected: true });

    await controller.refreshActiveThreads();

    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(refreshAppServerMetadata).not.toHaveBeenCalled();
  });

  it("ignores stale shared query failures while refreshing active threads", async () => {
    const { controller, host } = createController({ connected: true });
    const error = new Error("stale");
    vi.mocked(host.refreshSharedThreads).mockRejectedValueOnce(error);
    host.isStaleSharedQueryError = vi.fn((candidate) => candidate === error);

    await controller.refreshActiveThreads();

    expect(host.isStaleSharedQueryError).toHaveBeenCalledWith(error);
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("clears disconnected connection state on server exit while keeping last startup metadata", () => {
    const { controller, host, stateStore } = createController({ connected: true });
    const initializeResponse = { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" } as const;
    const runtimeConfig = { ...emptyRuntimeConfigSnapshot(), model: "gpt-5.1" };
    stateStore.dispatch({ type: "connection/initialized", initializeResponse });
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ id: "thread-1", title: "Thread 1" } as never],
      threadsLoaded: true,
    });
    stateStore.dispatch({
      type: "connection/metadata-applied",
      availableModels: [{ id: "model-1" } as never],
      availableSkills: [{ name: "skill-1" } as never],
      runtimeConfig,
    });

    controller.handleExit();

    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Codex app-server stopped.", {
      kind: "disconnected",
      message: "Codex app-server stopped.",
    });
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(stateStore.getState()).toMatchObject({
      threadList: {
        listedThreads: [],
        threadsLoaded: false,
      },
      connection: {
        availableModels: [],
        availableSkills: [],
        runtimeConfig,
        initializeResponse,
      },
    });
  });

  it("explains missing configured command failures", async () => {
    const { controller, connect, host } = createController();
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT", syscall: "spawn" });
    connect.mockRejectedValueOnce(error);

    await controller.ensureConnected();

    expect(host.setStatus).toHaveBeenCalledWith("Connection failed.", {
      kind: "failed",
      message:
        "Could not start Codex app-server because the configured command was not found: codex. Check the Codex command path in settings. (spawn codex ENOENT)",
    });
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "Could not start Codex app-server because the configured command was not found: codex. Check the Codex command path in settings. (spawn codex ENOENT)",
    );
    expect(host.notifyConnectionFailed).toHaveBeenCalledOnce();
  });

  it("ignores stale connection failures during startup", async () => {
    const { controller, connect, host } = createController();
    const error = new Error("stale connection");
    connect.mockRejectedValueOnce(error);
    host.isStaleConnectionError = vi.fn((candidate) => candidate === error);

    await controller.ensureConnected();

    expect(host.isStaleConnectionError).toHaveBeenCalledWith(error);
    expect(host.setStatus).toHaveBeenCalledWith("Starting Codex app-server...", { kind: "connecting" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });
});
