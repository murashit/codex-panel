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
  refreshPublishedAppServerMetadata: () => Promise<unknown>;
  refreshPublishedSkills: (forceReload?: boolean) => Promise<void>;
}

export interface ChatConnectionDiagnosticsActions {
  refreshPublishedDiagnosticProbes: (options?: { appServerMetadataSnapshot?: boolean; forceResourceProbes?: boolean }) => Promise<void>;
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

export class ChatConnectionController {
  constructor(private readonly host: ChatConnectionControllerHost) {}

  async ensureConnected(): Promise<void> {
    const connecting = this.host.connectionWork.active();
    if (connecting?.promise) return connecting.promise;

    if (this.host.connection.isConnected()) {
      return;
    }

    const connection = this.host.connectionWork.begin();
    const promise = this.initializeConnection(connection);
    connection.promise = promise;
    try {
      await promise;
    } finally {
      this.host.connectionWork.finish(connection, promise);
    }
  }

  invalidate(): void {
    this.host.connectionWork.invalidate();
  }

  handleExit(): void {
    handleChatConnectionExit(this.host);
  }

  async fetchActiveThreads(): Promise<void> {
    if (!this.host.connection.currentClient()) return;
    try {
      await this.host.loadSharedThreadList();
      this.host.refreshTabHeader();
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async refreshDiagnostics(): Promise<void> {
    this.host.clearDeferredDiagnostics();
    await this.ensureConnected();
    if (!this.host.connection.currentClient()) return;
    this.host.clearDeferredDiagnostics();
    await this.host.metadata.refreshPublishedAppServerMetadata();
    await this.host.diagnostics.refreshPublishedDiagnosticProbes({ appServerMetadataSnapshot: true });
  }

  async refreshStatusPanel(): Promise<void> {
    try {
      await this.refreshDiagnostics();
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    await this.fetchActiveThreads();
  }

  async refreshSkills(forceReload = false): Promise<void> {
    if (!this.host.connection.currentClient()) return;
    await this.host.metadata.refreshPublishedSkills(forceReload);
  }

  private async initializeConnection(connection: ActiveConnectionWork): Promise<void> {
    this.host.setStatus(STATUS_CONNECTION_STARTING, { kind: "connecting" });
    try {
      const initialization = await this.host.connection.connect();
      if (this.host.connectionWork.isStale(connection)) return;
      this.host.stateStore.dispatch({ type: "connection/initialized", initializeResponse: initialization });
      const client = this.host.connection.currentClient();
      if (!client) throw new Error("Codex app-server connection did not initialize.");
      await this.host.metadata.refreshPublishedAppServerMetadata();
      if (this.host.connectionWork.isStale(connection)) return;
      await this.host.loadSharedThreadList();
      if (this.host.connectionWork.isStale(connection)) return;
      this.host.scheduleDeferredDiagnostics();
      this.host.refreshTabHeader();
      this.host.setStatus(STATUS_CONNECTED, { kind: "connected" });
    } catch (error) {
      if (this.host.connectionWork.isStale(connection)) return;
      if (error instanceof StaleConnectionError) return;
      if (isStaleAppServerSharedQueryContextError(error)) return;
      const message = connectionErrorMessage(error, this.host.configuredCommand());
      this.host.setStatus(STATUS_CONNECTION_FAILED, { kind: "failed", message });
      this.host.addSystemMessage(message);
      this.host.notifyConnectionFailed();
    }
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
