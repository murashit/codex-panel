import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ChatConnectionPhase } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ActiveConnectionWork, ConnectionWorkTracker } from "./connection-work";

const STATUS_CONNECTION_STOPPED = "Codex app-server stopped.";
const STATUS_CONNECTION_STARTING = "Starting Codex app-server...";
const STATUS_CONNECTED = "Connected.";
const STATUS_CONNECTION_FAILED = "Connection failed.";

export interface ChatConnectionAdapter {
  connect(): Promise<ServerInitialization>;
  isConnected(): boolean;
}

export interface ChatConnectionMetadataActions {
  refreshAppServerMetadata: () => Promise<unknown>;
}

export interface ChatConnectionDiagnosticsActions {
  refreshServerDiagnostics: (options?: { appServerMetadataSnapshot?: boolean; forceResourceProbes?: boolean }) => Promise<void>;
}

export interface ChatConnectionActionsHost {
  stateStore: ChatStateStore;
  connection: ChatConnectionAdapter;
  connectionWork: ConnectionWorkTracker;
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
  refreshLiveState: () => void;
  isStaleConnectionError: (error: unknown) => boolean;
  isStaleSharedQueryError: (error: unknown) => boolean;
  notifyConnectionFailed: () => void;
}

type ChatConnectionExitHost = Pick<
  ChatConnectionActionsHost,
  "connectionWork" | "invalidateThreadWork" | "setStatus" | "stateStore" | "resetThreadTurnPresence" | "refreshLiveState"
>;

export function handleChatConnectionExit(host: ChatConnectionExitHost): void {
  host.connectionWork.invalidate();
  host.invalidateThreadWork();
  host.setStatus(STATUS_CONNECTION_STOPPED, { kind: "disconnected", message: STATUS_CONNECTION_STOPPED });
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.resetThreadTurnPresence(false);
  host.refreshLiveState();
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
  const actions: ChatConnectionActions = {
    ensureConnected: () => ensureConnected(host),
    invalidate: () => {
      host.connectionWork.invalidate();
    },
    handleExit: () => {
      handleChatConnectionExit(host);
    },
    refreshActiveThreads: () => refreshActiveThreads(host),
    refreshDiagnostics: () => refreshDiagnostics(host, actions),
    refreshStatusPanel: () => refreshStatusPanel(host, actions),
  };
  return actions;
}

async function ensureConnected(host: ChatConnectionActionsHost): Promise<void> {
  const connecting = host.connectionWork.active();
  if (connecting?.promise) return connecting.promise;

  if (host.connection.isConnected()) {
    return;
  }

  const connection = host.connectionWork.begin();
  const promise = initializeConnection(host, connection);
  connection.promise = promise;
  try {
    await promise;
  } finally {
    host.connectionWork.finish(connection, promise);
  }
}

async function refreshActiveThreads(host: ChatConnectionActionsHost): Promise<void> {
  if (!host.connection.isConnected()) return;
  try {
    await host.refreshSharedThreads();
    host.refreshTabHeader();
  } catch (error) {
    if (host.isStaleSharedQueryError(error)) return;
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

async function initializeConnection(host: ChatConnectionActionsHost, connection: ActiveConnectionWork): Promise<void> {
  host.setStatus(STATUS_CONNECTION_STARTING, { kind: "connecting" });
  try {
    const initialization = await host.connection.connect();
    if (host.connectionWork.isStale(connection)) return;
    host.stateStore.dispatch({ type: "connection/initialized", initializeResponse: initialization });
    if (!host.connection.isConnected()) throw new Error("Codex app-server connection did not initialize.");
    await host.metadata.refreshAppServerMetadata();
    if (host.connectionWork.isStale(connection)) return;
    await host.refreshSharedThreads();
    if (host.connectionWork.isStale(connection)) return;
    host.scheduleDeferredDiagnostics();
    host.refreshTabHeader();
    host.setStatus(STATUS_CONNECTED, { kind: "connected" });
  } catch (error) {
    if (host.connectionWork.isStale(connection)) return;
    if (host.isStaleConnectionError(error)) return;
    if (host.isStaleSharedQueryError(error)) return;
    const message = connectionErrorMessage(error, host.configuredCommand());
    host.setStatus(STATUS_CONNECTION_FAILED, { kind: "failed", message });
    host.addSystemMessage(message);
    host.notifyConnectionFailed();
  }
}

function connectionErrorMessage(error: unknown, configuredCommand: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isMissingCommandError(error)) return message;
  return `Could not start Codex app-server because the configured command was not found: ${configuredCommand}. Check the Codex command path in settings. (${message})`;
}

function isMissingCommandError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as { code?: unknown; syscall?: unknown };
  return candidate.code === "ENOENT" && candidate.syscall === "spawn";
}
