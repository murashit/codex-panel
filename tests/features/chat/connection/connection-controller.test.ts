import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { emptyRuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { ConnectionWorkTracker } from "../../../../src/shared/lifecycle/connection-work";
import {
  ChatConnectionController,
  type ChatConnectionAdapter,
  type ChatConnectionDiagnosticsActions,
  type ChatConnectionMetadataActions,
} from "../../../../src/features/chat/application/connection/connection-controller";

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
  } satisfies ChatConnectionMetadataActions;
  const diagnostics = {
    refreshPublishedDiagnosticProbes,
  } satisfies ChatConnectionDiagnosticsActions;
  const host = {
    stateStore,
    connection,
    connectionWork: new ConnectionWorkTracker(),
    metadata,
    diagnostics,
    invalidateResumeWork: vi.fn(),
    loadSharedThreadList: vi.fn().mockResolvedValue(undefined),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    refreshTabHeader: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    configuredCommand: () => "codex",
    refreshLiveState: vi.fn(),
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
    expect(refreshPublishedAppServerMetadata).toHaveBeenCalledOnce();
    expect(host.loadSharedThreadList).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
  });

  it("refreshes metadata before metadata-backed diagnostics", async () => {
    const { controller, host, refreshPublishedAppServerMetadata, refreshPublishedDiagnosticProbes } = createController({ connected: true });

    await controller.refreshDiagnostics();

    expect(host.clearDeferredDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshPublishedAppServerMetadata).toHaveBeenCalledOnce();
    expect(refreshPublishedDiagnosticProbes).toHaveBeenCalledWith({ appServerMetadataSnapshot: true });
  });

  it("refreshes active threads without refreshing metadata", async () => {
    const { controller, host, refreshPublishedAppServerMetadata } = createController({ connected: true });

    await controller.fetchActiveThreads();

    expect(host.loadSharedThreadList).toHaveBeenCalledOnce();
    expect(refreshPublishedAppServerMetadata).not.toHaveBeenCalled();
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
});
