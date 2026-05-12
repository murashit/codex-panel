import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import { AppServerClient, type AppServerClientHandlers } from "./client";

export interface ConnectionManagerHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
  onExit: () => void;
}

export type AppServerClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => AppServerClient;

export class StaleConnectionError extends Error {
  constructor() {
    super("Stale Codex app-server connection ignored.");
    this.name = "StaleConnectionError";
  }
}

export class ConnectionManager {
  private client: AppServerClient | null = null;
  private connectPromise: Promise<InitializeResponse> | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly codexPath: () => string,
    private readonly cwd: string,
    private readonly handlers: ConnectionManagerHandlers,
    private readonly clientFactory: AppServerClientFactory = (codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers),
  ) {}

  currentClient(): AppServerClient | null {
    return this.client?.isConnected() ? this.client : null;
  }

  isConnected(): boolean {
    return Boolean(this.currentClient());
  }

  async connect(): Promise<InitializeResponse> {
    this.disposed = false;
    if (this.client?.isConnected()) {
      return this.client.initializeResponse;
    }
    if (this.connectPromise) return this.connectPromise;

    const generation = ++this.generation;
    const client = this.clientFactory(this.codexPath(), this.cwd, {
      onNotification: (notification) => {
        if (this.isStale(generation)) return;
        this.handlers.onNotification(notification);
      },
      onServerRequest: (request) => {
        if (this.isStale(generation)) return;
        this.handlers.onServerRequest(request);
      },
      onLog: (message) => {
        if (this.isStale(generation)) return;
        this.handlers.onLog(message);
      },
      onExit: () => {
        if (this.isStale(generation)) return;
        this.client = null;
        this.connectPromise = null;
        this.handlers.onExit();
      },
    });
    this.client = client;
    this.connectPromise = client
      .connect()
      .then((response) => {
        if (this.isStale(generation)) {
          client.disconnect();
          throw new StaleConnectionError();
        }
        return response;
      })
      .catch((error: unknown) => {
        if (this.isStale(generation)) {
          throw error instanceof StaleConnectionError ? error : new StaleConnectionError();
        }
        if (!this.isStale(generation) && this.client === client) {
          this.client = null;
          client.disconnect();
        }
        throw error;
      })
      .finally(() => {
        if (!this.isStale(generation)) this.connectPromise = null;
      });

    return this.connectPromise;
  }

  reconnect(): void {
    this.disconnect();
    this.disposed = false;
  }

  disconnect(): void {
    this.disposed = true;
    this.generation += 1;
    this.connectPromise = null;
    this.client?.disconnect();
    this.client = null;
  }

  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.generation;
  }
}
