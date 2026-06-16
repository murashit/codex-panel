import { StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import type { AppServerClient } from "../../../../app-server/connection/client";
import { isStaleAppServerSharedQueryContextError } from "../../../../app-server/query/shared-queries";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ActiveConnectionWork, ConnectionWorkTracker } from "../../../../shared/lifecycle/connection-work";
import type { ChatConnectionPhase } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import {
  missingCommandConnectionErrorMessage,
  STATUS_CONNECTED,
  STATUS_CONNECTION_FAILED,
  STATUS_CONNECTION_STARTING,
  STATUS_CONNECTION_STOPPED,
} from "./messages";

export interface ChatConnectionAdapter {
  connect(): Promise<ServerInitialization>;
  currentClient(): AppServerClient | null;
  isConnected(): boolean;
}

export interface ChatConnectionMetadataActions {
  refreshAppServerMetadata: () => Promise<unknown>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
}

export interface ChatConnectionDiagnosticsActions {
  refreshDiagnosticProbes: (options?: { appServerMetadataSnapshot?: boolean; forceResourceProbes?: boolean }) => Promise<void>;
}

export interface ChatConnectionControllerHost {
  stateStore: ChatStateStore;
  connection: ChatConnectionAdapter;
  connectionWork: ConnectionWorkTracker;
  metadata: ChatConnectionMetadataActions;
  diagnostics: ChatConnectionDiagnosticsActions;
  invalidateResumeWork: () => void;
  loadSharedThreadList: () => Promise<void>;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  refreshTabHeader: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  configuredCommand: () => string;
  refreshLiveState: () => void;
  notifyConnectionFailed: () => void;
}

type ChatConnectionExitHost = Pick<
  ChatConnectionControllerHost,
  "connectionWork" | "invalidateResumeWork" | "setStatus" | "stateStore" | "resetThreadTurnPresence" | "refreshLiveState"
>;

export function handleChatConnectionExit(host: ChatConnectionExitHost): void {
  host.connectionWork.invalidate();
  host.invalidateResumeWork();
  host.setStatus(STATUS_CONNECTION_STOPPED, { kind: "disconnected", message: STATUS_CONNECTION_STOPPED });
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.resetThreadTurnPresence(false);
  host.refreshLiveState();
}

export interface ChatConnectionController {
  ensureConnected(): Promise<void>;
  invalidate(): void;
  handleExit(): void;
  fetchActiveThreads(): Promise<void>;
  refreshDiagnostics(): Promise<void>;
  refreshStatusPanel(): Promise<void>;
  refreshSkills(forceReload?: boolean): Promise<void>;
}

export function createChatConnectionController(host: ChatConnectionControllerHost): ChatConnectionController {
  const controller: ChatConnectionController = {
    ensureConnected: () => ensureConnected(host),
    invalidate: () => {
      host.connectionWork.invalidate();
    },
    handleExit: () => {
      handleChatConnectionExit(host);
    },
    fetchActiveThreads: () => fetchActiveThreads(host),
    refreshDiagnostics: () => refreshDiagnostics(host, controller),
    refreshStatusPanel: () => refreshStatusPanel(host, controller),
    refreshSkills: (forceReload = false) => refreshSkills(host, forceReload),
  };
  return controller;
}

async function ensureConnected(host: ChatConnectionControllerHost): Promise<void> {
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

async function fetchActiveThreads(host: ChatConnectionControllerHost): Promise<void> {
  if (!host.connection.currentClient()) return;
  try {
    await host.loadSharedThreadList();
    host.refreshTabHeader();
  } catch (error) {
    if (isStaleAppServerSharedQueryContextError(error)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function refreshDiagnostics(
  host: ChatConnectionControllerHost,
  controller: Pick<ChatConnectionController, "ensureConnected">,
): Promise<void> {
  host.clearDeferredDiagnostics();
  await controller.ensureConnected();
  if (!host.connection.currentClient()) return;
  host.clearDeferredDiagnostics();
  await host.metadata.refreshAppServerMetadata();
  await host.diagnostics.refreshDiagnosticProbes({ appServerMetadataSnapshot: true });
}

async function refreshStatusPanel(
  host: ChatConnectionControllerHost,
  controller: Pick<ChatConnectionController, "fetchActiveThreads" | "refreshDiagnostics">,
): Promise<void> {
  try {
    await controller.refreshDiagnostics();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
  await controller.fetchActiveThreads();
}

async function refreshSkills(host: ChatConnectionControllerHost, forceReload = false): Promise<void> {
  if (!host.connection.currentClient()) return;
  await host.metadata.refreshSkills(forceReload);
}

async function initializeConnection(host: ChatConnectionControllerHost, connection: ActiveConnectionWork): Promise<void> {
  host.setStatus(STATUS_CONNECTION_STARTING, { kind: "connecting" });
  try {
    const initialization = await host.connection.connect();
    if (host.connectionWork.isStale(connection)) return;
    host.stateStore.dispatch({ type: "connection/initialized", initializeResponse: initialization });
    const client = host.connection.currentClient();
    if (!client) throw new Error("Codex app-server connection did not initialize.");
    await host.metadata.refreshAppServerMetadata();
    if (host.connectionWork.isStale(connection)) return;
    await host.loadSharedThreadList();
    if (host.connectionWork.isStale(connection)) return;
    host.scheduleDeferredDiagnostics();
    host.refreshTabHeader();
    host.setStatus(STATUS_CONNECTED, { kind: "connected" });
  } catch (error) {
    if (host.connectionWork.isStale(connection)) return;
    if (error instanceof StaleConnectionError) return;
    if (isStaleAppServerSharedQueryContextError(error)) return;
    const message = connectionErrorMessage(error, host.configuredCommand());
    host.setStatus(STATUS_CONNECTION_FAILED, { kind: "failed", message });
    host.addSystemMessage(message);
    host.notifyConnectionFailed();
  }
}

function connectionErrorMessage(error: unknown, configuredCommand: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isMissingCommandError(error)) return message;
  return missingCommandConnectionErrorMessage(message, configuredCommand);
}

function isMissingCommandError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as { code?: unknown; syscall?: unknown };
  return candidate.code === "ENOENT" && candidate.syscall === "spawn";
}
