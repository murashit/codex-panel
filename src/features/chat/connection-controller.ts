import { StaleConnectionError } from "../../app-server/connection-manager";
import type { AppServerClient } from "../../app-server/client";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ChatAction, ChatStateStore } from "./chat-state";
import type { ChatAppServerController } from "./chat-app-server-controller";
import type { ChatConnectionWorkTracker, ActiveChatConnection } from "./view-lifecycle";

export interface ChatConnectionAdapter {
  connect(): Promise<InitializeResponse>;
  currentClient(): AppServerClient | null;
  isConnected(): boolean;
}

export interface ChatConnectionControllerHost {
  stateStore: ChatStateStore;
  connection: ChatConnectionAdapter;
  connectionWork: ChatConnectionWorkTracker;
  appServer: ChatAppServerController;
  setClient: (client: AppServerClient | null) => void;
  invalidateResumeWork: () => void;
  loadSharedThreadList: () => Promise<void>;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  refreshTabHeader: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
  refreshLiveState: () => void;
  render: () => void;
  scheduleRender: () => void;
  notifyConnectionFailed: () => void;
}

export class ChatConnectionController {
  constructor(private readonly host: ChatConnectionControllerHost) {}

  async ensureConnected(): Promise<void> {
    const connecting = this.host.connectionWork.active();
    if (connecting?.promise) return connecting.promise;

    if (this.host.connection.isConnected()) {
      this.host.setClient(this.host.connection.currentClient());
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
    this.invalidate();
    this.host.invalidateResumeWork();
    this.host.setStatus("Codex app-server stopped.");
    this.dispatch({ type: "connection/scoped-cleared" });
    this.host.resetThreadTurnPresence(false);
    this.host.setClient(null);
    this.host.refreshLiveState();
    this.host.render();
  }

  async refreshThreads(): Promise<void> {
    this.host.setClient(this.host.connection.currentClient());
    if (!this.host.connection.currentClient()) return;
    try {
      await this.host.loadSharedThreadList();
      await this.host.appServer.refreshPublishedAppServerMetadata();
      this.host.refreshTabHeader();
      this.host.render();
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async refreshDiagnostics(): Promise<void> {
    this.host.clearDeferredDiagnostics();
    await this.ensureConnected();
    if (!this.host.connection.currentClient()) return;
    this.host.clearDeferredDiagnostics();
    await this.host.appServer.refreshPublishedCapabilityDiagnostics();
    this.host.render();
  }

  async refreshStatusPanel(): Promise<void> {
    try {
      await this.refreshDiagnostics();
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    await this.refreshThreads();
  }

  async refreshSkills(forceReload = false): Promise<void> {
    this.host.setClient(this.host.connection.currentClient());
    if (!this.host.connection.currentClient()) return;
    await this.host.appServer.refreshPublishedSkills(forceReload);
    this.host.render();
  }

  private async initializeConnection(connection: ActiveChatConnection): Promise<void> {
    this.host.setStatus("Starting Codex app-server...");
    try {
      this.dispatch({ type: "connection/initialized", initializeResponse: await this.host.connection.connect() });
      if (this.host.connectionWork.isStale(connection)) return;
      const client = this.host.connection.currentClient();
      this.host.setClient(client);
      if (!client) throw new Error("Codex app-server connection did not initialize.");
      await this.host.appServer.refreshPublishedAppServerMetadata();
      if (this.host.connectionWork.isStale(connection)) return;
      await this.host.loadSharedThreadList();
      if (this.host.connectionWork.isStale(connection)) return;
      this.host.scheduleDeferredDiagnostics();
      this.host.refreshTabHeader();
      this.host.setStatus("Connected.");
    } catch (error) {
      if (this.host.connectionWork.isStale(connection)) return;
      if (error instanceof StaleConnectionError) return;
      this.host.setStatus("Connection failed.");
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      this.host.notifyConnectionFailed();
    }
    if (!this.host.connectionWork.isStale(connection)) {
      this.host.scheduleRender();
    }
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }
}
