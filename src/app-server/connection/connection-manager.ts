import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { ServerInitialization } from "../../domain/server/initialization";
import { AppServerClient, type AppServerClientHandlers } from "./client";
import { appServerInitializationFromResponse } from "../protocol/initialization";

export interface ConnectionManagerHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
  onExit: () => void;
}

export type AppServerClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => AppServerClient;

type ConnectionLifecycleState =
  | { kind: "idle"; generation: number }
  | {
      kind: "connecting";
      generation: number;
      codexPath: string;
      cwd: string;
      client: AppServerClient;
      promise: Promise<ServerInitialization>;
    }
  | { kind: "connected"; generation: number; codexPath: string; cwd: string; client: AppServerClient }
  | { kind: "disconnected"; generation: number };

export class StaleConnectionError extends Error {
  constructor() {
    super("Stale Codex app-server connection ignored.");
    this.name = "StaleConnectionError";
  }
}

export class ConnectionManager {
  private state: ConnectionLifecycleState = { kind: "idle", generation: 0 };

  constructor(
    private readonly codexPath: () => string,
    private readonly cwd: string,
    private readonly clientFactory: AppServerClientFactory = (codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers),
  ) {}

  currentClient(): AppServerClient | null {
    return this.state.kind === "connected" && this.state.client.isConnected() && this.stateMatchesCurrentContext(this.state)
      ? this.state.client
      : null;
  }

  isConnected(): boolean {
    return Boolean(this.currentClient());
  }

  async connect(handlers: ConnectionManagerHandlers): Promise<ServerInitialization> {
    const currentClient = this.currentClient();
    if (currentClient) {
      return appServerInitializationFromResponse(currentClient.initializeResponse);
    }
    if (this.state.kind === "connecting" && this.stateMatchesCurrentContext(this.state)) return this.state.promise;
    if (this.state.kind === "connecting" || this.state.kind === "connected") this.disconnect();

    const generation = this.state.generation + 1;
    const codexPath = this.codexPath();
    const cwd = this.cwd;
    const client = this.clientFactory(codexPath, cwd, {
      onNotification: (notification) => {
        if (this.isStale(generation)) return;
        handlers.onNotification(notification);
      },
      onServerRequest: (request) => {
        if (this.isStale(generation)) return;
        handlers.onServerRequest(request);
      },
      onLog: (message) => {
        if (this.isStale(generation)) return;
        handlers.onLog(message);
      },
      onExit: () => {
        if (this.isStale(generation)) return;
        this.state = { kind: "disconnected", generation };
        handlers.onExit();
      },
    });
    const promise = client
      .connect()
      .then((response) => {
        if (this.isStale(generation)) {
          client.disconnect();
          throw new StaleConnectionError();
        }
        this.state = { kind: "connected", generation, codexPath, cwd, client };
        return appServerInitializationFromResponse(response);
      })
      .catch((error: unknown) => {
        if (this.isStale(generation)) {
          throw error instanceof StaleConnectionError ? error : new StaleConnectionError();
        }
        if (this.state.kind === "connecting" && this.state.client === client) {
          this.state = { kind: "disconnected", generation };
          client.disconnect();
        }
        throw error;
      });

    this.state = { kind: "connecting", generation, codexPath, cwd, client, promise };
    return promise;
  }

  resetConnection(): void {
    this.disconnect();
  }

  disconnect(): void {
    const previous = this.state;
    this.state = { kind: "disconnected", generation: previous.generation + 1 };
    if (previous.kind === "connecting" || previous.kind === "connected") {
      previous.client.disconnect();
    }
  }

  private isStale(generation: number): boolean {
    return generation !== this.state.generation;
  }

  private stateMatchesCurrentContext(state: Extract<ConnectionLifecycleState, { kind: "connecting" | "connected" }>): boolean {
    return state.codexPath === this.codexPath() && state.cwd === this.cwd;
  }
}
