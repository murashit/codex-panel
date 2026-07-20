import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ChatConnectionPhase } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_CONNECTION_STOPPED = "Codex app-server stopped.";
const STATUS_CONNECTION_STARTING = "Starting Codex app-server...";
const STATUS_CONNECTED = "Connected.";
const STATUS_CONNECTION_FAILED = "Connection failed.";

interface ChatConnectionAdapter {
  connect(): Promise<ServerInitialization>;
  isConnected(): boolean;
}

interface ChatConnectionMetadataActions {
  refreshAppServerMetadata: () => Promise<unknown>;
}

interface ChatConnectionDiagnosticsActions {
  refreshServerDiagnostics: (options?: { appServerMetadataSnapshot?: boolean; forceResourceProbes?: boolean }) => Promise<void>;
}

export interface ChatConnectionActionsHost {
  stateStore: ChatStateStore;
  connection: ChatConnectionAdapter;
  canConnect: () => boolean;
  metadata: ChatConnectionMetadataActions;
  diagnostics: ChatConnectionDiagnosticsActions;
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
  isStaleRuntimeError: (error: unknown) => boolean;
  notifyConnectionFailed: () => void;
}

type ChatConnectionExitHost = Pick<
  ChatConnectionActionsHost,
  "invalidateThreadWork" | "setStatus" | "stateStore" | "resetThreadTurnPresence"
>;

function handleChatConnectionExit(host: ChatConnectionExitHost): void {
  host.invalidateThreadWork();
  host.setStatus(STATUS_CONNECTION_STOPPED, { kind: "disconnected", message: STATUS_CONNECTION_STOPPED });
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.resetThreadTurnPresence(false);
}

export interface ChatConnectionActions {
  ensureConnected(): Promise<void>;
  invalidate(): void;
  handleExit(): void;
  refreshActiveThreads(): Promise<void>;
  refreshDiagnostics(): Promise<void>;
  refreshStatusPanel(): Promise<void>;
}

export function createChatConnectionActions(host: ChatConnectionActionsHost): ChatConnectionActions {
  let generation = 0;
  let activeConnection: { generation: number; promise: Promise<void> } | null = null;
  const invalidate = (): void => {
    generation += 1;
    activeConnection = null;
  };
  const isStale = (candidateGeneration: number): boolean => candidateGeneration !== generation;
  const actions: ChatConnectionActions = {
    ensureConnected: async () => {
      if (!host.canConnect()) return;
      if (activeConnection) return activeConnection.promise;
      if (host.connection.isConnected()) return;

      const connectionGeneration = generation;
      const promise = initializeConnection(host, () => isStale(connectionGeneration));
      const active = { generation: connectionGeneration, promise };
      activeConnection = active;
      try {
        await promise;
      } finally {
        if (activeConnection === active) {
          activeConnection = null;
        }
      }
    },
    invalidate,
    handleExit: () => {
      invalidate();
      handleChatConnectionExit(host);
    },
    refreshActiveThreads: () => refreshActiveThreads(host),
    refreshDiagnostics: () => refreshDiagnostics(host, actions),
    refreshStatusPanel: () => refreshStatusPanel(host, actions),
  };
  return actions;
}

async function refreshActiveThreads(host: ChatConnectionActionsHost): Promise<void> {
  if (!host.connection.isConnected()) return;
  try {
    await host.refreshSharedThreads();
    host.refreshTabHeader();
  } catch (error) {
    if (host.isStaleRuntimeError(error)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function refreshDiagnostics(host: ChatConnectionActionsHost, actions: Pick<ChatConnectionActions, "ensureConnected">): Promise<void> {
  host.clearDeferredDiagnostics();
  await actions.ensureConnected();
  if (!host.connection.isConnected()) return;
  host.clearDeferredDiagnostics();
  await host.metadata.refreshAppServerMetadata();
  await host.diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });
}

async function refreshStatusPanel(
  host: ChatConnectionActionsHost,
  actions: Pick<ChatConnectionActions, "refreshActiveThreads" | "refreshDiagnostics">,
): Promise<void> {
  try {
    await actions.refreshDiagnostics();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
  await actions.refreshActiveThreads();
}

async function initializeConnection(host: ChatConnectionActionsHost, isStale: () => boolean): Promise<void> {
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
    if (host.isStaleRuntimeError(error)) return;
    const message = connectionErrorMessage(error, host.configuredCommand());
    host.setStatus(STATUS_CONNECTION_FAILED, { kind: "failed", message });
    host.addSystemMessage(message);
    host.notifyConnectionFailed();
    return;
  }

  await hydrateConnectedResources(host, isStale);
}

async function hydrateConnectedResources(host: ChatConnectionActionsHost, isStale: () => boolean): Promise<void> {
  try {
    await host.metadata.refreshAppServerMetadata();
  } catch (error) {
    if (isStale() || host.isStaleRuntimeError(error)) return;
    host.addSystemMessage(`Could not refresh Codex metadata: ${errorMessage(error)}`);
  }
  if (isStale()) return;

  try {
    await host.refreshSharedThreads();
  } catch (error) {
    if (isStale() || host.isStaleRuntimeError(error)) return;
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
