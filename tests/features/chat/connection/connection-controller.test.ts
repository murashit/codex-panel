import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/client";
import { emptyRuntimeConfigSnapshot } from "../../../../src/app-server/runtime-config";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import {
  ChatConnectionController,
  type ChatConnectionAdapter,
  type ChatConnectionDiagnosticsPort,
  type ChatConnectionMetadataPort,
} from "../../../../src/features/chat/connection/connection-controller";
import { ChatConnectionWorkTracker } from "../../../../src/features/chat/panel/lifecycle";

function createController({ connected = false, client = {} as AppServerClient } = {}) {
  const stateStore = createChatStateStore(createChatState());
  let currentClient: AppServerClient | null = connected ? client : null;
  const connect = vi.fn().mockImplementation(async () => {
    currentClient = client;
    return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
  });
  const connection: ChatConnectionAdapter = {
    connect,
    currentClient: () => currentClient,
    isConnected: () => Boolean(currentClient),
  };
  const refreshPublishedAppServerMetadata = vi.fn().mockResolvedValue(null);
  const refreshPublishedDiagnosticProbes = vi.fn().mockResolvedValue(undefined);
  const refreshPublishedSkills = vi.fn().mockResolvedValue(undefined);
  const metadata = {
    refreshPublishedAppServerMetadata,
    refreshPublishedSkills,
  } satisfies ChatConnectionMetadataPort;
  const diagnostics = {
    refreshPublishedDiagnosticProbes,
  } satisfies ChatConnectionDiagnosticsPort;
  const setClient = vi.fn((next: AppServerClient | null) => {
    currentClient = next;
  });
  const host = {
    stateStore,
    connection,
    connectionWork: new ChatConnectionWorkTracker(),
    metadata,
    diagnostics,
    setClient,
    invalidateResumeWork: vi.fn(),
    loadSharedThreadList: vi.fn().mockResolvedValue(undefined),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    refreshTabHeader: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    publishAppServerIdentity: vi.fn(),
    configuredCommand: () => "codex",
    refreshLiveState: vi.fn(),
    render: vi.fn(),
    scheduleRender: vi.fn(),
    notifyConnectionFailed: vi.fn(),
  };
  return {
    connect,
    controller: new ChatConnectionController(host),
    host,
    refreshPublishedAppServerMetadata,
    refreshPublishedDiagnosticProbes,
    stateStore,
  };
}

describe("ChatConnectionController", () => {
  it("connects once and publishes startup metadata", async () => {
    const { connect, controller, host, refreshPublishedAppServerMetadata, stateStore } = createController();

    await controller.ensureConnected();

    expect(connect).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.initializeResponse).toEqual({
      codexHome: "/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "test",
    });
    expect(host.publishAppServerIdentity).toHaveBeenNthCalledWith(1, null);
    expect(host.publishAppServerIdentity).toHaveBeenNthCalledWith(2, "test");
    expect(refreshPublishedAppServerMetadata).toHaveBeenCalledOnce();
    expect(host.loadSharedThreadList).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.");
    expect(host.scheduleRender).toHaveBeenCalledOnce();
  });

  it("refreshes diagnostics after clearing deferred diagnostics", async () => {
    const { controller, host, refreshPublishedDiagnosticProbes } = createController({ connected: true });

    await controller.refreshDiagnostics();

    expect(host.clearDeferredDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshPublishedDiagnosticProbes).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
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

    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.publishAppServerIdentity).toHaveBeenCalledWith(null);
    expect(host.setStatus).toHaveBeenCalledWith("Codex app-server stopped.");
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.setClient).toHaveBeenCalledWith(null);
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
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

    expect(host.setStatus).toHaveBeenCalledWith("Connection failed.");
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "Could not start Codex app-server because the configured command was not found: codex. Check the Codex command path in settings. (spawn codex ENOENT)",
    );
    expect(host.notifyConnectionFailed).toHaveBeenCalledOnce();
  });
});
