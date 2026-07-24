import { describe, expect, it, vi } from "vitest";
import {
  type ChatConnectionCoordinatorHost,
  createChatConnectionCoordinator,
} from "../../../../../src/features/chat/application/connection/connection-coordinator";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { deferred } from "../../../../support/async";
import { runtimeConfigFixture } from "../../../../support/runtime-config";

type ChatConnectionPort = ChatConnectionCoordinatorHost["connection"];
type ChatConnectionMetadataEffects = ChatConnectionCoordinatorHost["metadataEffects"];
type ChatConnectionDiagnosticsCoordinator = ChatConnectionCoordinatorHost["diagnosticsCoordinator"];

function createCoordinatorHarness({ connected = false, canConnect = true } = {}) {
  const stateStore = createChatStateStore(createChatState());
  let isConnected = connected;
  const connect = vi.fn().mockImplementation(async () => {
    isConnected = true;
    return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
  });
  const connection: ChatConnectionPort = {
    connect,
    isConnected: () => isConnected,
  };
  const refreshAppServerMetadata = vi.fn().mockResolvedValue(null);
  const refreshServerDiagnostics = vi.fn().mockResolvedValue(undefined);
  const metadataEffects = {
    refreshAppServerMetadata,
  } satisfies ChatConnectionMetadataEffects;
  const diagnosticsCoordinator = {
    refreshServerDiagnostics,
  } satisfies ChatConnectionDiagnosticsCoordinator;
  const host: ChatConnectionCoordinatorHost = {
    stateStore,
    connection,
    canConnect: () => canConnect,
    metadataEffects,
    diagnosticsCoordinator,
    invalidateThreadWork: vi.fn(),
    refreshSharedThreads: vi.fn().mockResolvedValue(undefined),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    refreshTabHeader: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    configuredCommand: () => "codex",
    isStaleConnectionError: () => false,
    isStaleRuntimeError: () => false,
    notifyConnectionFailed: vi.fn(),
  };
  return {
    connect,
    coordinator: createChatConnectionCoordinator(host),
    host,
    refreshAppServerMetadata,
    refreshServerDiagnostics,
    setConnected: (value: boolean) => {
      isConnected = value;
    },
    stateStore,
  };
}

describe("ChatConnectionCoordinator", () => {
  it("does not acquire a connection after its owner starts closing", async () => {
    const { coordinator, connect } = createCoordinatorHarness({ canConnect: false });

    await coordinator.ensureConnected();

    expect(connect).not.toHaveBeenCalled();
  });

  it("coalesces concurrent connection attempts inside the coordinator boundary", async () => {
    const { coordinator, connect, setConnected } = createCoordinatorHarness();
    const pending = deferred<Awaited<ReturnType<ChatConnectionPort["connect"]>>>();
    connect.mockImplementationOnce(() => pending.promise);

    const first = coordinator.ensureConnected();
    const second = coordinator.ensureConnected();

    expect(connect).toHaveBeenCalledOnce();
    setConnected(true);
    pending.resolve({ codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" });
    await Promise.all([first, second]);
  });

  it("starts fresh work after invalidation and ignores the obsolete result", async () => {
    const { coordinator, connect, setConnected, stateStore } = createCoordinatorHarness();
    const obsolete = deferred<Awaited<ReturnType<ChatConnectionPort["connect"]>>>();
    const current = deferred<Awaited<ReturnType<ChatConnectionPort["connect"]>>>();
    connect.mockImplementationOnce(() => obsolete.promise).mockImplementationOnce(() => current.promise);

    const first = coordinator.ensureConnected();
    coordinator.invalidate();
    const second = coordinator.ensureConnected();
    setConnected(true);
    current.resolve({ codexHome: "/current", platformFamily: "unix", platformOs: "macos", userAgent: "test" });
    await second;
    obsolete.resolve({ codexHome: "/obsolete", platformFamily: "unix", platformOs: "macos", userAgent: "test" });
    await first;

    expect(connect).toHaveBeenCalledTimes(2);
    expect(stateStore.getState().connection.initializeResponse?.codexHome).toBe("/current");
  });

  it("connects once and publishes startup metadata", async () => {
    const { connect, coordinator, host, refreshAppServerMetadata, stateStore } = createCoordinatorHarness();

    await coordinator.ensureConnected();

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

  it("publishes initialization readiness before shared resources finish hydrating", async () => {
    const { coordinator, host, refreshAppServerMetadata, stateStore } = createCoordinatorHarness();
    const metadata = deferred<void>();
    refreshAppServerMetadata.mockReturnValueOnce(metadata.promise);

    await coordinator.ensureInitialized();

    expect(stateStore.getState().connection.initializeResponse).toMatchObject({ codexHome: "/codex" });
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
    expect(host.refreshSharedThreads).not.toHaveBeenCalled();
    expect(host.scheduleDeferredDiagnostics).not.toHaveBeenCalled();

    let connected = false;
    const fullyConnected = coordinator.ensureConnected().then(() => {
      connected = true;
    });
    await Promise.resolve();
    expect(connected).toBe(false);

    metadata.resolve(undefined);
    await fullyConnected;

    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
  });

  it("keeps the initialized connection usable when metadata hydration fails", async () => {
    const { coordinator, host, refreshAppServerMetadata, stateStore } = createCoordinatorHarness();
    refreshAppServerMetadata.mockRejectedValueOnce(new Error("config unavailable"));

    await coordinator.ensureConnected();

    expect(stateStore.getState().connection.initializeResponse).toMatchObject({ codexHome: "/codex" });
    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).toHaveBeenCalledWith("Could not refresh Codex metadata: config unavailable");
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });

  it("keeps the initialized connection usable when thread hydration fails", async () => {
    const { coordinator, host } = createCoordinatorHarness();
    vi.mocked(host.refreshSharedThreads).mockRejectedValueOnce(new Error("threads unavailable"));

    await coordinator.ensureConnected();

    expect(host.setStatus).toHaveBeenCalledWith("Connected.", { kind: "connected" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).toHaveBeenCalledWith("Could not refresh Codex threads: threads unavailable");
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });

  it("refreshes metadata before server diagnostics", async () => {
    const { coordinator, host, refreshAppServerMetadata, refreshServerDiagnostics } = createCoordinatorHarness({ connected: true });

    await coordinator.refreshDiagnostics();

    expect(host.clearDeferredDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(refreshServerDiagnostics).toHaveBeenCalledWith({ appServerMetadataSnapshot: true });
  });

  it("refreshes active threads without refreshing metadata", async () => {
    const { coordinator, host, refreshAppServerMetadata } = createCoordinatorHarness({ connected: true });

    await coordinator.refreshActiveThreads();

    expect(host.refreshSharedThreads).toHaveBeenCalledOnce();
    expect(refreshAppServerMetadata).not.toHaveBeenCalled();
  });

  it("ignores stale resource context failures while refreshing active threads", async () => {
    const { coordinator, host } = createCoordinatorHarness({ connected: true });
    const error = new Error("stale");
    vi.mocked(host.refreshSharedThreads).mockRejectedValueOnce(error);
    host.isStaleRuntimeError = vi.fn((candidate) => candidate === error);

    await coordinator.refreshActiveThreads();

    expect(host.isStaleRuntimeError).toHaveBeenCalledWith(error);
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("clears disconnected connection state on server exit while keeping last startup metadata", () => {
    const { coordinator, host, stateStore } = createCoordinatorHarness({ connected: true });
    const initializeResponse = { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" } as const;
    const runtimeConfig = { ...runtimeConfigFixture(), model: "gpt-5.1" };
    stateStore.dispatch({ type: "connection/initialized", initializeResponse });
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ id: "thread-1", title: "Thread 1" } as never],
    });
    stateStore.dispatch({
      type: "connection/metadata-applied",
      availableModels: [{ id: "model-1" } as never],
      availableSkills: [{ name: "skill-1" } as never],
      runtimeConfig,
    });
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: {
        id: "thread-1",
        preview: "Thread 1",
        name: "Thread 1",
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        provenance: { kind: "interactive" },
      },
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    coordinator.handleExit();

    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Codex app-server stopped.", {
      kind: "disconnected",
      message: "Codex app-server stopped.",
    });
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(stateStore.getState()).toMatchObject({
      threadList: {
        listedThreads: [{ id: "thread-1", title: "Thread 1" }],
      },
      panelThread: { kind: "awaiting-resume", threadId: "thread-1", fallbackTitle: "Thread 1" },
      connection: {
        availableModels: [{ id: "model-1" }],
        availableSkills: [{ name: "skill-1" }],
        runtimeConfig,
        initializeResponse,
      },
    });
  });

  it("explains missing configured command failures", async () => {
    const { coordinator, connect, host } = createCoordinatorHarness();
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT", syscall: "spawn" });
    connect.mockRejectedValueOnce(error);

    await coordinator.ensureConnected();

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
    const { coordinator, connect, host } = createCoordinatorHarness();
    const error = new Error("stale connection");
    connect.mockRejectedValueOnce(error);
    host.isStaleConnectionError = vi.fn((candidate) => candidate === error);

    await coordinator.ensureConnected();

    expect(host.isStaleConnectionError).toHaveBeenCalledWith(error);
    expect(host.setStatus).toHaveBeenCalledWith("Starting Codex app-server...", { kind: "connecting" });
    expect(host.setStatus).not.toHaveBeenCalledWith("Connection failed.", expect.anything());
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.notifyConnectionFailed).not.toHaveBeenCalled();
  });
});
