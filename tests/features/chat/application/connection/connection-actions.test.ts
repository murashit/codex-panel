import { describe, expect, it, vi } from "vitest";

import { emptyRuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import {
  type ChatConnectionActionsHost,
  type ChatConnectionAdapter,
  type ChatConnectionDiagnosticsActions,
  type ChatConnectionMetadataActions,
  createChatConnectionActions,
} from "../../../../../src/features/chat/application/connection/connection-actions";
import { ConnectionWorkTracker } from "../../../../../src/features/chat/application/connection/connection-work";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";

function createActionsHarness({ connected = false } = {}) {
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
  const host: ChatConnectionActionsHost = {
    stateStore,
    connection,
    connectionWork: new ConnectionWorkTracker(),
    metadata,
    diagnostics,
    invalidateThreadWork: vi.fn(),
    refreshSharedThreads: vi.fn().mockResolvedValue(undefined),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
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
    actions: createChatConnectionActions(host),
    host,
    refreshAppServerMetadata,
    refreshServerDiagnostics,
    stateStore,
  };
}

describe("ChatConnectionActions", () => {
  it("connects once and publishes startup metadata", async () => {
    const { connect, actions, host, refreshAppServerMetadata, stateStore } = createActionsHarness();

    await actions.ensureConnected();

    expect(connect).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.initializeResponse).toEqual({
      codexHome: "/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "test",
    });
    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
  });

  it("keeps the initialized connection usable when metadata hydration fails", async () => {
    const { actions, host, refreshAppServerMetadata, stateStore } = createActionsHarness();
    refreshAppServerMetadata.mockRejectedValueOnce(new Error("config unavailable"));

    await actions.ensureConnected();

    expect(stateStore.getState().connection.initializeResponse).toMatchObject({ codexHome: "/codex" });
    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).toHaveBeenCalledWith("Could not refresh Codex metadata: config unavailable");
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });

  it("keeps the initialized connection usable when thread hydration fails", async () => {
    const { actions, host } = createActionsHarness();
    vi.mocked(host.refreshSharedThreads).mockRejectedValueOnce(new Error("threads unavailable"));

    await actions.ensureConnected();

    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).toHaveBeenCalledWith("Could not refresh Codex threads: threads unavailable");
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });

  it("refreshes metadata before server diagnostics", async () => {
    const { actions, host, refreshAppServerMetadata, refreshServerDiagnostics } = createActionsHarness({ connected: true });

    await actions.refreshDiagnostics();

    expect(host.clearDeferredDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(refreshServerDiagnostics).toHaveBeenCalledWith({ appServerMetadataSnapshot: true });
  });

  it("refreshes active threads without refreshing metadata", async () => {
    const { actions, host, refreshAppServerMetadata } = createActionsHarness({ connected: true });

    await actions.refreshActiveThreads();

    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(refreshAppServerMetadata).not.toHaveBeenCalled();
  });

  it("ignores stale shared query failures while refreshing active threads", async () => {
    const { actions, host } = createActionsHarness({ connected: true });
    const error = new Error("stale");
    vi.mocked(host.refreshSharedThreads).mockRejectedValueOnce(error);
    host.isStaleSharedQueryError = vi.fn((candidate) => candidate === error);

    await actions.refreshActiveThreads();

    expect(host.isStaleSharedQueryError).toHaveBeenCalledWith(error);
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("clears disconnected connection state on server exit while keeping last startup metadata", () => {
    const { actions, host, stateStore } = createActionsHarness({ connected: true });
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

    actions.handleExit();

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
    const { actions, connect, host } = createActionsHarness();
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT", syscall: "spawn" });
    connect.mockRejectedValueOnce(error);

    await actions.ensureConnected();

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
    const { actions, connect, host } = createActionsHarness();
    const error = new Error("stale connection");
    connect.mockRejectedValueOnce(error);
    host.isStaleConnectionError = vi.fn((candidate) => candidate === error);

    await actions.ensureConnected();

    expect(host.isStaleConnectionError).toHaveBeenCalledWith(error);
    expect(host.setStatus).toHaveBeenCalledWith("Starting Codex app-server...", { kind: "connecting" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });
});
