import type { ServerInitialization } from "../../domain/server/initialization";
import type { InitializeParams } from "../../generated/app-server/InitializeParams";
import type { AppServerClient, AppServerServerRequestResponder } from "./client";
import type { AppServerClientAccess } from "./client-access";
import { ConnectionManager, type ConnectionManagerHandlers, StaleConnectionError } from "./connection-manager";
import type { ServerNotification, ServerRequest } from "./rpc-messages";

export interface AppServerContextConnectionLeaseHandlers {
  onNotification(notification: ServerNotification): void;
  onServerRequest(request: ServerRequest, responder: AppServerServerRequestResponder): boolean;
  onLog(message: string): void;
  onExit(): void;
}

export interface AppServerContextConnectionHandlers {
  onNotification(notification: ServerNotification): boolean;
  onExit(): void;
}

export interface AppServerContextConnectionLease {
  connect(handlers: AppServerContextConnectionLeaseHandlers): Promise<ServerInitialization>;
  currentClient(): AppServerClient | null;
  isConnected(): boolean;
  disconnect(): void;
}

interface ActiveLease {
  readonly handlers: AppServerContextConnectionLeaseHandlers;
}

interface ContextConnectionManager {
  connect(handlers: ConnectionManagerHandlers): Promise<ServerInitialization>;
  currentClient(): AppServerClient | null;
  disconnect(): void;
}

export class AppServerContextConnection implements AppServerClientAccess {
  private readonly manager: ContextConnectionManager;
  private readonly leases = new Set<ActiveLease>();
  private disposed = false;

  constructor(
    codexPath: string,
    cwd: string,
    initializeParams: InitializeParams,
    private readonly handlers: AppServerContextConnectionHandlers,
    manager?: ContextConnectionManager,
  ) {
    this.manager = manager ?? new ConnectionManager(codexPath, cwd, initializeParams);
  }

  createLease(): AppServerContextConnectionLease {
    this.assertActive();
    let active: ActiveLease | null = null;
    const isAttached = (): boolean => {
      return active !== null && this.leases.has(active);
    };
    return {
      connect: async (handlers) => {
        this.assertActive();
        if (active) this.leases.delete(active);
        const nextActive = { handlers };
        active = nextActive;
        this.leases.add(nextActive);
        try {
          const initialization = await this.connect();
          if (active !== nextActive || !this.leases.has(nextActive)) throw new StaleConnectionError();
          return initialization;
        } catch (error) {
          if (active === nextActive) {
            this.leases.delete(nextActive);
            active = null;
          }
          throw error;
        }
      },
      currentClient: () => (isAttached() ? this.manager.currentClient() : null),
      isConnected: () => isAttached() && this.manager.currentClient() !== null,
      disconnect: () => {
        if (active) this.leases.delete(active);
        active = null;
      },
    };
  }

  async withClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    this.assertActive();
    await this.connect();
    this.assertActive();
    const client = this.manager.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    return operation(client);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.disconnect();
    for (const lease of this.leases) lease.handlers.onExit();
    this.leases.clear();
  }

  private connect(): Promise<ServerInitialization> {
    return this.manager.connect(this.managerHandlers());
  }

  private managerHandlers(): ConnectionManagerHandlers {
    return {
      onNotification: (notification) => {
        if (this.handlers.onNotification(notification)) return;
        for (const lease of this.activeLeases()) lease.handlers.onNotification(notification);
      },
      onServerRequest: (request, responder) => {
        for (const lease of this.activeLeases()) {
          if (lease.handlers.onServerRequest(request, responder)) return;
        }
        responder.reject(-32601, `No Codex Panel view can handle app-server request: ${request.method}`);
      },
      onLog: (message) => {
        for (const lease of this.activeLeases()) lease.handlers.onLog(message);
      },
      onExit: () => {
        const exitedLeases = this.activeLeases();
        this.leases.clear();
        this.handlers.onExit();
        for (const lease of exitedLeases) lease.handlers.onExit();
      },
    };
  }

  private activeLeases(): ActiveLease[] {
    return [...this.leases];
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Codex app-server context connection is disposed.");
  }
}
