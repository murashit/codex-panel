import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import {
  ChatConnectionController,
  type ChatConnectionAdapter,
} from "../../../../../src/features/chat/controllers/connection/connection-controller";
import { createConnectionStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import { ChatConnectionWorkTracker } from "../../../../../src/features/chat/view-lifecycle";
import type { ChatAppServerController } from "../../../../../src/features/chat/chat-app-server-controller";

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
  const refreshPublishedCapabilityDiagnostics = vi.fn().mockResolvedValue(undefined);
  const refreshPublishedSkills = vi.fn().mockResolvedValue(undefined);
  const appServer = {
    refreshPublishedAppServerMetadata,
    refreshPublishedCapabilityDiagnostics,
    refreshPublishedSkills,
  } as unknown as ChatAppServerController;
  const setClient = vi.fn((next: AppServerClient | null) => {
    currentClient = next;
  });
  const host = {
    state: createConnectionStatePort(stateStore),
    connection,
    connectionWork: new ChatConnectionWorkTracker(),
    appServer,
    setClient,
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
    render: vi.fn(),
    scheduleRender: vi.fn(),
    notifyConnectionFailed: vi.fn(),
  };
  return {
    connect,
    controller: new ChatConnectionController(host),
    host,
    refreshPublishedAppServerMetadata,
    refreshPublishedCapabilityDiagnostics,
    stateStore,
  };
}

describe("ChatConnectionController", () => {
  it("connects once and publishes startup metadata", async () => {
    const { connect, controller, host, refreshPublishedAppServerMetadata, stateStore } = createController();

    await controller.ensureConnected();

    expect(connect).toHaveBeenCalledOnce();
    expect(stateStore.getState().initializeResponse).toEqual({
      codexHome: "/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "test",
    });
    expect(refreshPublishedAppServerMetadata).toHaveBeenCalledOnce();
    expect(host.loadSharedThreadList).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.");
    expect(host.scheduleRender).toHaveBeenCalledOnce();
  });

  it("refreshes diagnostics after clearing deferred diagnostics", async () => {
    const { controller, host, refreshPublishedCapabilityDiagnostics } = createController({ connected: true });

    await controller.refreshDiagnostics();

    expect(host.clearDeferredDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshPublishedCapabilityDiagnostics).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
  });

  it("clears connection-scoped state on server exit", () => {
    const { controller, host, stateStore } = createController({ connected: true });
    stateStore.dispatch({
      type: "thread/list-applied",
      threads: [{ id: "thread-1", title: "Thread 1" } as never],
      threadsLoaded: true,
      availableModels: [{ id: "model-1" } as never],
      availableSkills: [{ name: "skill-1" } as never],
    });

    controller.handleExit();

    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Codex app-server stopped.");
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.setClient).toHaveBeenCalledWith(null);
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
    expect(stateStore.getState()).toMatchObject({
      listedThreads: [],
      threadsLoaded: false,
      availableModels: [],
      availableSkills: [],
      runtimePicker: null,
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
