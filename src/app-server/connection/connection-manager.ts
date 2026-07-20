import type { ServerInitialization } from "../../domain/server/initialization";
import type { InitializeParams } from "../../generated/app-server/InitializeParams";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import { AppServerClient, type AppServerClientHandlers, type AppServerServerRequestResponder } from "./client";

export interface ConnectionManagerHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest, responder: AppServerServerRequestResponder) => void;
  onLog: (message: string) => void;
  onExit: () => void;
}

type AppServerClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => AppServerClient;

type ConnectionLifecycleState =
  | { kind: "idle"; generation: number }
  | {
      kind: "connecting";
      generation: number;
      client: AppServerClient;
      promise: Promise<ServerInitialization>;
    }
  | { kind: "connected"; generation: number; client: AppServerClient }
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
    private readonly codexPath: string,
    private readonly cwd: string,
    initializeParams: InitializeParams,
    private readonly clientFactory: AppServerClientFactory = (codexPath, cwd, handlers) =>
      new AppServerClient({ codexPath, cwd, handlers, initializeParams }),
  ) {}

  currentClient(): AppServerClient | null {
    return this.state.kind === "connected" && this.state.client.isConnected() ? this.state.client : null;
  }

  isConnected(): boolean {
    return Boolean(this.currentClient());
  }

  async connect(handlers: ConnectionManagerHandlers): Promise<ServerInitialization> {
    const currentClient = this.currentClient();
    if (currentClient) {
      return serverInitializationFromResponse(currentClient.initializeResponse);
    }
    if (this.state.kind === "connecting") return this.state.promise;
    if (this.state.kind === "connected") this.disconnect();

    const generation = this.state.generation + 1;
    const codexPath = this.codexPath;
    const cwd = this.cwd;
    const client = this.clientFactory(codexPath, cwd, {
      onNotification: (notification) => {
        if (this.isStale(generation)) return;
        handlers.onNotification(notification);
      },
      onServerRequest: (request, responder) => {
        if (this.isStale(generation)) return;
        handlers.onServerRequest(request, responder);
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
        this.state = { kind: "connected", generation, client };
        return serverInitializationFromResponse(response);
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

    this.state = { kind: "connecting", generation, client, promise };
    return promise;
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
}

function serverInitializationFromResponse(response: ServerInitialization): ServerInitialization {
  return {
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  };
}
