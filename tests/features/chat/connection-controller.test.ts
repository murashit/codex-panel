import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { ChatConnectionController, type ChatConnectionAdapter } from "../../../src/features/chat/connection-controller";
import { ChatConnectionWorkTracker } from "../../../src/features/chat/view-lifecycle";
import type { ChatAppServerController } from "../../../src/features/chat/chat-app-server-controller";

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
    stateStore,
    connection,
    connectionWork: new ChatConnectionWorkTracker(),
    appServer,
    setClient,
    loadSharedThreadList: vi.fn().mockResolvedValue(undefined),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    refreshTabHeader: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
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
});
