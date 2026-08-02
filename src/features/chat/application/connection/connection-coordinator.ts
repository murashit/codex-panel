import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ChatConnectionPhase } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_CONNECTION_STOPPED = "Codex app-server stopped.";
const STATUS_CONNECTION_STARTING = "Starting Codex app-server...";
const STATUS_CONNECTED = "Connected.";
const STATUS_CONNECTION_FAILED = "Connection failed.";

interface ChatConnectionPort {
  connect(): Promise<ServerInitialization>;
  isConnected(): boolean;
}

export interface ChatConnectionCoordinatorHost {
  stateStore: ChatStateStore;
  connection: ChatConnectionPort;
  canConnect: () => boolean;
  refreshAppServerMetadata: () => Promise<unknown>;
  refreshServerDiagnostics: () => Promise<void>;
  invalidateThreadWork: () => void;
  refreshSharedThreads: () => Promise<void>;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  refreshTabHeader: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  configuredCommand: () => string;
  isStaleConnectionError: (error: unknown) => boolean;
  notifyConnectionFailed: () => void;
}

type ChatConnectionExitHost = Pick<
  ChatConnectionCoordinatorHost,
  "invalidateThreadWork" | "setStatus" | "stateStore" | "resetThreadTurnPresence"
>;

function handleChatConnectionExit(host: ChatConnectionExitHost): void {
  host.invalidateThreadWork();
  host.setStatus(STATUS_CONNECTION_STOPPED, { kind: "disconnected", message: STATUS_CONNECTION_STOPPED });
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.resetThreadTurnPresence(false);
}

export interface ChatConnectionCoordinator {
  ensureConnected(): Promise<void>;
  ensureHydrated(): Promise<void>;
  invalidate(): void;
  handleExit(): void;
  refreshActiveThreads(): Promise<void>;
  refreshDiagnostics(): Promise<void>;
  refreshStatusPanel(): Promise<void>;
}

export function createChatConnectionCoordinator(host: ChatConnectionCoordinatorHost): ChatConnectionCoordinator {
  let generation = 0;
  let activeConnection: { initialization: Promise<void>; hydration: Promise<void> } | null = null;
  const invalidate = (): void => {
    generation += 1;
    activeConnection = null;
  };
  const isStale = (candidateGeneration: number): boolean => candidateGeneration !== generation;
  const startConnection = (): NonNullable<typeof activeConnection> => {
    const connectionGeneration = generation;
    const connectionIsStale = (): boolean => isStale(connectionGeneration);
    const initialization = initializeConnection(host, connectionIsStale);
    const hydration = initialization.then(async () => {
      if (connectionIsStale() || !host.connection.isConnected()) return;
      await hydrateConnectedResources(host, connectionIsStale);
    });
    const active = { initialization, hydration };
    activeConnection = active;
    const clear = (): void => {
      if (activeConnection === active) activeConnection = null;
    };
    void hydration.then(clear, clear);
    return active;
  };
  const coordinator: ChatConnectionCoordinator = {
    ensureConnected: async () => {
      if (!host.canConnect()) return;
      if (activeConnection) return activeConnection.initialization;
      if (host.connection.isConnected()) return;
      await startConnection().initialization;
    },
    ensureHydrated: async () => {
      if (!host.canConnect()) return;
      if (activeConnection) return activeConnection.hydration;
      if (host.connection.isConnected()) return;
      await startConnection().hydration;
    },
    invalidate,
    handleExit: () => {
      invalidate();
      handleChatConnectionExit(host);
    },
    refreshActiveThreads: () => refreshActiveThreads(host),
    refreshDiagnostics: () => refreshDiagnostics(host, coordinator),
    refreshStatusPanel: () => refreshStatusPanel(host, coordinator),
  };
  return coordinator;
}

async function refreshActiveThreads(host: ChatConnectionCoordinatorHost): Promise<void> {
  if (!host.connection.isConnected()) return;
  try {
    await host.refreshSharedThreads();
    host.refreshTabHeader();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function refreshDiagnostics(
  host: ChatConnectionCoordinatorHost,
  coordinator: Pick<ChatConnectionCoordinator, "ensureConnected">,
): Promise<void> {
  host.clearDeferredDiagnostics();
  await coordinator.ensureConnected();
  if (!host.connection.isConnected()) return;
  await refreshConnectedDiagnostics(host);
}

async function refreshConnectedDiagnostics(host: ChatConnectionCoordinatorHost): Promise<void> {
  host.clearDeferredDiagnostics();
  const [metadataResult, diagnosticsResult] = await Promise.allSettled([host.refreshAppServerMetadata(), host.refreshServerDiagnostics()]);
  if (metadataResult.status === "rejected") throw metadataResult.reason;
  if (diagnosticsResult.status === "rejected") throw diagnosticsResult.reason;
}

async function refreshStatusPanel(
  host: ChatConnectionCoordinatorHost,
  coordinator: Pick<ChatConnectionCoordinator, "ensureConnected">,
): Promise<void> {
  host.clearDeferredDiagnostics();
  await coordinator.ensureConnected();
  if (!host.connection.isConnected()) return;
  const refreshDiagnostics = (): Promise<void> =>
    refreshConnectedDiagnostics(host).catch((error: unknown) => {
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    });
  await Promise.all([refreshDiagnostics(), refreshActiveThreads(host)]);
}

async function initializeConnection(host: ChatConnectionCoordinatorHost, isStale: () => boolean): Promise<void> {
  host.setStatus(STATUS_CONNECTION_STARTING, { kind: "connecting" });
  try {
    const initialization = await host.connection.connect();
    if (isStale()) return;
    host.stateStore.dispatch({ type: "connection/initialized", initializeResponse: initialization });
    if (!host.connection.isConnected()) throw new Error("Codex app-server connection did not initialize.");
    host.refreshTabHeader();
    host.setStatus(STATUS_CONNECTED, { kind: "connected" });
  } catch (error) {
    if (isStale()) return;
    if (host.isStaleConnectionError(error)) return;
    const message = connectionErrorMessage(error, host.configuredCommand());
    host.setStatus(STATUS_CONNECTION_FAILED, { kind: "failed", message });
    host.addSystemMessage(message);
    host.notifyConnectionFailed();
    return;
  }
}

async function hydrateConnectedResources(host: ChatConnectionCoordinatorHost, isStale: () => boolean): Promise<void> {
  try {
    await host.refreshAppServerMetadata();
  } catch (error) {
    if (isStale()) return;
    host.addSystemMessage(`Could not refresh Codex metadata: ${errorMessage(error)}`);
  }
  if (isStale()) return;

  try {
    await host.refreshSharedThreads();
  } catch (error) {
    if (isStale()) return;
    host.addSystemMessage(`Could not refresh Codex threads: ${errorMessage(error)}`);
  }
  if (isStale()) return;
  host.scheduleDeferredDiagnostics();
}

function connectionErrorMessage(error: unknown, configuredCommand: string): string {
  const message = errorMessage(error);
  if (!isMissingCommandError(error)) return message;
  return `Could not start Codex app-server because the configured command was not found: ${configuredCommand}. Check the Codex command path in settings. (${message})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingCommandError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as { code?: unknown; syscall?: unknown };
  return candidate.code === "ENOENT" && candidate.syscall === "spawn";
}
