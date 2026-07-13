import type { InitializeParams } from "../../generated/app-server/InitializeParams";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { AppsListResponse } from "../../generated/app-server/v2/AppsListResponse";
import type { CollaborationModeListResponse } from "../../generated/app-server/v2/CollaborationModeListResponse";
import type { ConfigReadResponse } from "../../generated/app-server/v2/ConfigReadResponse";
import type { ConfigWriteResponse } from "../../generated/app-server/v2/ConfigWriteResponse";
import type { EnvironmentInfoResponse } from "../../generated/app-server/v2/EnvironmentInfoResponse";
import type { FsReadFileResponse } from "../../generated/app-server/v2/FsReadFileResponse";
import type { GetAccountRateLimitsResponse } from "../../generated/app-server/v2/GetAccountRateLimitsResponse";
import type { HooksListResponse } from "../../generated/app-server/v2/HooksListResponse";
import type { ListMcpServerStatusResponse } from "../../generated/app-server/v2/ListMcpServerStatusResponse";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import type { ModelProviderCapabilitiesReadResponse } from "../../generated/app-server/v2/ModelProviderCapabilitiesReadResponse";
import type { PermissionProfileListResponse } from "../../generated/app-server/v2/PermissionProfileListResponse";
import type { PluginInstalledResponse } from "../../generated/app-server/v2/PluginInstalledResponse";
import type { PluginReadResponse } from "../../generated/app-server/v2/PluginReadResponse";
import type { SkillsListResponse } from "../../generated/app-server/v2/SkillsListResponse";
import type { ThreadArchiveResponse } from "../../generated/app-server/v2/ThreadArchiveResponse";
import type { ThreadCompactStartResponse } from "../../generated/app-server/v2/ThreadCompactStartResponse";
import type { ThreadDeleteResponse } from "../../generated/app-server/v2/ThreadDeleteResponse";
import type { ThreadForkResponse } from "../../generated/app-server/v2/ThreadForkResponse";
import type { ThreadGoalClearResponse } from "../../generated/app-server/v2/ThreadGoalClearResponse";
import type { ThreadGoalGetResponse } from "../../generated/app-server/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetResponse } from "../../generated/app-server/v2/ThreadGoalSetResponse";
import type { ThreadInjectItemsResponse } from "../../generated/app-server/v2/ThreadInjectItemsResponse";
import type { ThreadItemsListResponse } from "../../generated/app-server/v2/ThreadItemsListResponse";
import type { ThreadListResponse } from "../../generated/app-server/v2/ThreadListResponse";
import type { ThreadReadResponse } from "../../generated/app-server/v2/ThreadReadResponse";
import type { ThreadResumeResponse } from "../../generated/app-server/v2/ThreadResumeResponse";
import type { ThreadRollbackResponse } from "../../generated/app-server/v2/ThreadRollbackResponse";
import type { ThreadSetNameResponse } from "../../generated/app-server/v2/ThreadSetNameResponse";
import type { ThreadSettingsUpdateResponse } from "../../generated/app-server/v2/ThreadSettingsUpdateResponse";
import type { ThreadStartResponse } from "../../generated/app-server/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "../../generated/app-server/v2/ThreadTurnsListResponse";
import type { ThreadUnarchiveResponse } from "../../generated/app-server/v2/ThreadUnarchiveResponse";
import type { ThreadUnsubscribeResponse } from "../../generated/app-server/v2/ThreadUnsubscribeResponse";
import type { TurnInterruptResponse } from "../../generated/app-server/v2/TurnInterruptResponse";
import type { TurnStartResponse } from "../../generated/app-server/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../../generated/app-server/v2/TurnSteerResponse";
import { JsonRpcClient } from "./json-rpc-client";
import type { ClientRequestMethod, ClientRequestParams, RpcOutboundMessage } from "./rpc-messages";
import { type AppServerTransport, type AppServerTransportHandlers, StdioAppServerTransport } from "./transport";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface AppServerClientHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest, responder: AppServerServerRequestResponder) => void;
  onLog: (message: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface AppServerServerRequestResponder {
  respond(result: unknown): void;
  reject(code: number, message: string): void;
}

export type AppServerTransportFactory = (handlers: AppServerTransportHandlers) => AppServerTransport;

export interface AppServerClientOptions {
  codexPath: string;
  cwd: string;
  handlers: AppServerClientHandlers;
  initializeParams: InitializeParams;
  requestTimeoutMs?: number;
  transportFactory?: AppServerTransportFactory;
}

export interface ClientResponseByMethod {
  initialize: InitializeResponse;
  "config/batchWrite": ConfigWriteResponse;
  "config/read": ConfigReadResponse;
  "hooks/list": HooksListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/goal/get": ThreadGoalGetResponse;
  "thread/goal/set": ThreadGoalSetResponse;
  "thread/goal/clear": ThreadGoalClearResponse;
  "thread/inject_items": ThreadInjectItemsResponse;
  "thread/list": ThreadListResponse;
  "thread/read": ThreadReadResponse;
  "thread/archive": ThreadArchiveResponse;
  "thread/delete": ThreadDeleteResponse;
  "thread/unsubscribe": ThreadUnsubscribeResponse;
  "thread/unarchive": ThreadUnarchiveResponse;
  "thread/rollback": ThreadRollbackResponse;
  "thread/name/set": ThreadSetNameResponse;
  "thread/settings/update": ThreadSettingsUpdateResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/items/list": ThreadItemsListResponse;
  "skills/list": SkillsListResponse;
  "app/list": AppsListResponse;
  "plugin/installed": PluginInstalledResponse;
  "plugin/read": PluginReadResponse;
  "model/list": ModelListResponse;
  "permissionProfile/list": PermissionProfileListResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "collaborationMode/list": CollaborationModeListResponse;
  "modelProvider/capabilities/read": ModelProviderCapabilitiesReadResponse;
  "thread/compact/start": ThreadCompactStartResponse;
  "turn/start": TurnStartResponse;
  "turn/steer": TurnSteerResponse;
  "turn/interrupt": TurnInterruptResponse;
  "fs/readFile": FsReadFileResponse;
  "environment/info": EnvironmentInfoResponse;
}

export type TypedClientRequestMethod = Extract<ClientRequestMethod, keyof ClientResponseByMethod>;

type AppServerClientLifecycleState =
  | { kind: "disconnected" }
  | { kind: "starting"; transport: AppServerTransport }
  | { kind: "initialized"; transport: AppServerTransport; initializeResponse: InitializeResponse };

export class AppServerClient {
  private lifecycle: AppServerClientLifecycleState = { kind: "disconnected" };
  private readonly rpc: JsonRpcClient;
  private readonly intentionallyStoppedTransports = new WeakSet<AppServerTransport>();
  private readonly codexPath: string;
  private readonly cwd: string;
  private readonly handlers: AppServerClientHandlers;
  private readonly initializeParams: InitializeParams;
  private readonly requestTimeoutMs: number;
  private readonly transportFactory: AppServerTransportFactory | undefined;

  constructor(options: AppServerClientOptions) {
    this.codexPath = options.codexPath;
    this.cwd = options.cwd;
    this.handlers = options.handlers;
    this.initializeParams = options.initializeParams;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.transportFactory = options.transportFactory;
    this.rpc = new JsonRpcClient({
      requestTimeoutMs: this.requestTimeoutMs,
      send: (message) => {
        this.send(message);
      },
      onNotification: this.handlers.onNotification,
      onServerRequest: (request) => {
        this.handlers.onServerRequest(request, {
          respond: (result) => {
            this.respondToServerRequest(request.id, result);
          },
          reject: (code, message) => {
            this.rejectServerRequest(request.id, code, message);
          },
        });
      },
      onLog: this.handlers.onLog,
    });
  }

  async connect(): Promise<InitializeResponse> {
    if (this.lifecycle.kind !== "disconnected") {
      throw new Error("Codex app-server client is already connecting or connected.");
    }

    const transportRef: { current: AppServerTransport | null } = { current: null };
    const transportHandlers: AppServerTransportHandlers = {
      onLine: (line) => {
        const transport = transportRef.current;
        if (!transport) return;
        if (!this.isActiveTransport(transport)) return;
        this.rpc.handleLine(line);
      },
      onLog: (message) => {
        const transport = transportRef.current;
        if (!transport) return;
        if (!this.isActiveTransport(transport)) return;
        this.handlers.onLog(message);
      },
      onError: (error) => {
        const transport = transportRef.current;
        if (!transport) return;
        if (!this.isActiveTransport(transport)) return;
        this.failActiveTransport(transport, error);
      },
      onExit: (code, signal) => {
        const transport = transportRef.current;
        if (!transport) return;
        if (!this.isActiveTransport(transport)) return;
        const intentional = this.intentionallyStoppedTransports.has(transport);
        const wasInitialized = this.lifecycle.kind === "initialized";
        this.lifecycle = { kind: "disconnected" };
        this.rpc.rejectAll(new Error(`Codex app-server exited: ${String(code ?? signal ?? "unknown")}`));
        if (intentional || !wasInitialized) return;
        this.handlers.onExit(code, signal);
      },
    };
    const transport = this.transportFactory
      ? this.transportFactory(transportHandlers)
      : new StdioAppServerTransport(this.codexPath, this.cwd, transportHandlers);
    transportRef.current = transport;
    this.lifecycle = { kind: "starting", transport };
    try {
      transport.start();
      const init = await this.request("initialize", this.initializeParams);
      this.notify({ method: "initialized" });
      this.lifecycle = { kind: "initialized", transport, initializeResponse: init };
      return init;
    } catch (error) {
      if (this.isActiveTransport(transport)) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.lifecycle = { kind: "disconnected" };
        this.rpc.rejectAll(normalized);
        this.intentionallyStoppedTransports.add(transport);
        transport.stop();
      }
      throw error;
    }
  }

  disconnect(): void {
    const transport = this.activeTransport();
    this.lifecycle = { kind: "disconnected" };
    this.rpc.rejectAll(new Error("Codex app-server disconnected."));
    if (!transport) return;
    this.intentionallyStoppedTransports.add(transport);
    transport.stop();
  }

  isConnected(): boolean {
    return this.lifecycle.kind === "initialized" && this.lifecycle.transport.isRunning();
  }

  get initializeResponse(): InitializeResponse {
    if (this.lifecycle.kind !== "initialized") throw new Error("Codex app-server has not initialized.");
    return this.lifecycle.initializeResponse;
  }

  respondToServerRequest(requestId: RequestId, result: unknown): void {
    this.rpc.respond(requestId, result);
  }

  rejectServerRequest(requestId: RequestId, code: number, message: string): void {
    this.rpc.reject(requestId, code, message);
  }

  request<M extends TypedClientRequestMethod>(
    method: M,
    params: ClientRequestParams<M>,
    options: { timeoutMs?: number } = {},
  ): Promise<ClientResponseByMethod[M]> {
    return this.rpc.request<M, ClientResponseByMethod[M]>(method, params, options);
  }

  private notify(message: RpcOutboundMessage): void {
    this.rpc.notify(message);
  }

  private send(message: RpcOutboundMessage): void {
    const transport = this.activeTransport();
    if (!transport?.isRunning()) {
      throw new Error("Codex app-server is not running.");
    }
    transport.send(message);
  }

  private activeTransport(): AppServerTransport | null {
    return this.lifecycle.kind === "disconnected" ? null : this.lifecycle.transport;
  }

  private isActiveTransport(transport: AppServerTransport): boolean {
    return this.activeTransport() === transport;
  }

  private failActiveTransport(transport: AppServerTransport, error: Error): void {
    if (!this.isActiveTransport(transport)) return;
    const wasInitialized = this.lifecycle.kind === "initialized";
    this.lifecycle = { kind: "disconnected" };
    this.rpc.rejectAll(error);
    this.intentionallyStoppedTransports.add(transport);
    transport.stop();
    if (wasInitialized) {
      this.handlers.onExit(null, null);
    }
  }
}
