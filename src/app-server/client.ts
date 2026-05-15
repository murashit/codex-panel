import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { ConfigWriteResponse } from "../generated/app-server/v2/ConfigWriteResponse";
import type { GetAccountRateLimitsResponse } from "../generated/app-server/v2/GetAccountRateLimitsResponse";
import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { HooksListResponse } from "../generated/app-server/v2/HooksListResponse";
import type { ModelListResponse } from "../generated/app-server/v2/ModelListResponse";
import type { SkillsListResponse } from "../generated/app-server/v2/SkillsListResponse";
import type { ThreadArchiveResponse } from "../generated/app-server/v2/ThreadArchiveResponse";
import type { ThreadForkResponse } from "../generated/app-server/v2/ThreadForkResponse";
import type { ThreadListResponse } from "../generated/app-server/v2/ThreadListResponse";
import type { ThreadResumeResponse } from "../generated/app-server/v2/ThreadResumeResponse";
import type { ThreadRollbackResponse } from "../generated/app-server/v2/ThreadRollbackResponse";
import type { ThreadSetNameResponse } from "../generated/app-server/v2/ThreadSetNameResponse";
import type { SortDirection } from "../generated/app-server/v2/SortDirection";
import type { ThreadStartResponse } from "../generated/app-server/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "../generated/app-server/v2/ThreadTurnsListResponse";
import type { ThreadUnarchiveResponse } from "../generated/app-server/v2/ThreadUnarchiveResponse";
import type { TurnItemsView } from "../generated/app-server/v2/TurnItemsView";
import type { TurnStartResponse } from "../generated/app-server/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../generated/app-server/v2/TurnSteerResponse";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import { CLIENT_VERSION } from "../constants";
import { StdioAppServerTransport, type AppServerTransport, type AppServerTransportHandlers } from "./transport";
import type { ClientRequestMethod, ClientRequestParams, PendingRequest, RpcInboundMessage, RpcOutboundMessage } from "./types";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { ServiceTierRequest } from "./service-tier";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface AppServerClientHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export type AppServerTransportFactory = (handlers: AppServerTransportHandlers) => AppServerTransport;

interface ClientResponseByMethod {
  initialize: InitializeResponse;
  "config/batchWrite": ConfigWriteResponse;
  "config/read": ConfigReadResponse;
  "hooks/list": HooksListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/list": ThreadListResponse;
  "thread/archive": ThreadArchiveResponse;
  "thread/unarchive": ThreadUnarchiveResponse;
  "thread/rollback": ThreadRollbackResponse;
  "thread/name/set": ThreadSetNameResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "skills/list": SkillsListResponse;
  "model/list": ModelListResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "thread/compact/start": Record<string, never>;
  "turn/start": TurnStartResponse;
  "turn/steer": TurnSteerResponse;
  "turn/interrupt": unknown;
}

type TypedClientRequestMethod = Extract<ClientRequestMethod, keyof ClientResponseByMethod>;

function toUserInput(input: string | UserInput[]): UserInput[] {
  if (typeof input !== "string") return input;
  return [{ type: "text", text: input, text_elements: [] }];
}

export class AppServerClient {
  private transport: AppServerTransport | null = null;
  private nextId = 1;
  private pending = new Map<RequestId, PendingRequest>();
  private initialized = false;
  private initResponse: InitializeResponse | null = null;

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerClientHandlers,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly transportFactory?: AppServerTransportFactory,
  ) {}

  async connect(): Promise<InitializeResponse> {
    if (this.transport?.isRunning()) {
      throw new Error("Codex app-server is already running.");
    }

    const transportHandlers: AppServerTransportHandlers = {
      onLine: (line) => this.handleLine(line),
      onLog: this.handlers.onLog,
      onError: (error) => this.rejectAll(error),
      onExit: (code, signal) => {
        this.initialized = false;
        this.initResponse = null;
        this.rejectAll(new Error(`Codex app-server exited: ${code ?? signal ?? "unknown"}`));
        this.handlers.onExit(code, signal);
      },
    };
    this.transport = this.transportFactory
      ? this.transportFactory(transportHandlers)
      : new StdioAppServerTransport(this.codexPath, this.cwd, transportHandlers);
    this.transport.start();

    const init = await this.request("initialize", {
      clientInfo: {
        name: "obsidian_codex_panel",
        title: "Codex Panel",
        version: CLIENT_VERSION,
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify({ method: "initialized" });
    this.initialized = true;
    this.initResponse = init;
    return init;
  }

  disconnect(): void {
    this.initialized = false;
    this.initResponse = null;
    this.transport?.stop();
    this.transport = null;
    this.rejectAll(new Error("Codex app-server disconnected."));
  }

  isConnected(): boolean {
    return this.initialized && this.transport !== null && this.transport.isRunning();
  }

  get initializeResponse(): InitializeResponse {
    if (!this.initResponse) throw new Error("Codex app-server has not initialized.");
    return this.initResponse;
  }

  readEffectiveConfig(cwd: string): Promise<ConfigReadResponse> {
    return this.request("config/read", { cwd, includeLayers: false });
  }

  listHooks(cwd: string): Promise<HooksListResponse> {
    return this.request("hooks/list", { cwds: [cwd] });
  }

  trustHook(hook: HookMetadata): Promise<ConfigWriteResponse> {
    return this.writeHookState(hook.key, {
      enabled: true,
      trusted_hash: hook.currentHash,
    });
  }

  setHookEnabled(hook: HookMetadata, enabled: boolean): Promise<ConfigWriteResponse> {
    const state: { [key: string]: JsonValue } = { enabled };
    if (hook.trustStatus === "trusted") {
      state.trusted_hash = hook.currentHash;
    }
    return this.writeHookState(hook.key, state);
  }

  startThread(cwd: string, serviceTier?: ServiceTierRequest): Promise<ThreadStartResponse> {
    return this.request("thread/start", {
      cwd,
      serviceName: "codex-panel",
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
  }

  startEphemeralThread(cwd: string, serviceName: string, developerInstructions: string): Promise<ThreadStartResponse> {
    return this.request("thread/start", {
      cwd,
      serviceName,
      developerInstructions,
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      environments: [],
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
  }

  resumeThread(threadId: string, cwd: string): Promise<ThreadResumeResponse> {
    return this.request("thread/resume", {
      threadId,
      cwd,
      excludeTurns: true,
      persistExtendedHistory: false,
    });
  }

  forkThread(threadId: string, cwd: string): Promise<ThreadForkResponse> {
    return this.request("thread/fork", {
      threadId,
      cwd,
      excludeTurns: true,
      persistExtendedHistory: false,
    });
  }

  listThreads(cwd: string, archived = false): Promise<ThreadListResponse> {
    return this.request("thread/list", {
      cwd,
      limit: 20,
      archived,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
  }

  archiveThread(threadId: string): Promise<ThreadArchiveResponse> {
    return this.request("thread/archive", { threadId });
  }

  unarchiveThread(threadId: string): Promise<ThreadUnarchiveResponse> {
    return this.request("thread/unarchive", { threadId });
  }

  rollbackThread(threadId: string): Promise<ThreadRollbackResponse> {
    return this.request("thread/rollback", { threadId, numTurns: 1 });
  }

  setThreadName(threadId: string, name: string): Promise<ThreadSetNameResponse> {
    return this.request("thread/name/set", { threadId, name });
  }

  threadTurnsList(
    threadId: string,
    cursor: string | null = null,
    limit = 20,
    sortDirection: SortDirection = "desc",
    itemsView: TurnItemsView = "full",
  ): Promise<ThreadTurnsListResponse> {
    return this.request("thread/turns/list", {
      threadId,
      cursor,
      limit,
      sortDirection,
      itemsView,
    });
  }

  listSkills(cwd: string): Promise<SkillsListResponse> {
    return this.request("skills/list", {
      cwds: [cwd],
      forceReload: false,
    });
  }

  listModels(includeHidden = false): Promise<ModelListResponse> {
    return this.request("model/list", {
      includeHidden,
      limit: 100,
    });
  }

  readAccountRateLimits(): Promise<GetAccountRateLimitsResponse> {
    return this.request("account/rateLimits/read", undefined);
  }

  compactThread(threadId: string): Promise<Record<string, never>> {
    return this.request("thread/compact/start", { threadId });
  }

  startTurn(
    threadId: string,
    cwd: string,
    input: string | UserInput[],
    serviceTier?: ServiceTierRequest,
    collaborationMode?: CollaborationMode | null,
    model?: string | null,
    effort?: ReasoningEffort | null,
  ): Promise<TurnStartResponse> {
    const params: ClientRequestParams<"turn/start"> & { collaborationMode?: CollaborationMode | null } = {
      threadId,
      cwd,
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      input: toUserInput(input),
    };
    if (collaborationMode) params.collaborationMode = collaborationMode;
    if (model !== undefined) params.model = model;
    if (effort !== undefined) params.effort = effort;
    return this.request("turn/start", params);
  }

  startStructuredTurn(
    threadId: string,
    cwd: string,
    text: string,
    outputSchema: JsonValue,
    model?: string,
    effort?: ReasoningEffort,
  ): Promise<TurnStartResponse> {
    const params: ClientRequestParams<"turn/start"> = {
      threadId,
      cwd,
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
      outputSchema,
    };
    if (model !== undefined) params.model = model;
    if (effort !== undefined) params.effort = effort;
    return this.request("turn/start", params);
  }

  steerTurn(threadId: string, expectedTurnId: string, input: string | UserInput[]): Promise<TurnSteerResponse> {
    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: toUserInput(input),
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  private writeHookState(key: string, state: { [key: string]: JsonValue }): Promise<ConfigWriteResponse> {
    return this.request("config/batchWrite", {
      edits: [
        {
          keyPath: "hooks.state",
          value: {
            [key]: state,
          },
          mergeStrategy: "upsert",
        },
      ],
      reloadUserConfig: true,
    });
  }

  respondToServerRequest(requestId: RequestId, result: unknown): void {
    this.send({ id: requestId, result });
  }

  rejectServerRequest(requestId: RequestId, code: number, message: string): void {
    this.send({ id: requestId, error: { code, message } });
  }

  private request<M extends TypedClientRequestMethod>(method: M, params: ClientRequestParams<M>): Promise<ClientResponseByMethod[M]> {
    const id = this.nextId++;
    const promise = new Promise<ClientResponseByMethod[M]>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
    });

    try {
      this.send({ id, method, params } as RpcOutboundMessage);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pending.delete(id);
      }
      throw error;
    }

    return promise;
  }

  private notify(message: RpcOutboundMessage): void {
    this.send(message);
  }

  private send(message: RpcOutboundMessage): void {
    if (!this.transport?.isRunning()) {
      throw new Error("Codex app-server is not running.");
    }
    this.transport.send(message);
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;

    let message: RpcInboundMessage;
    try {
      message = JSON.parse(line) as RpcInboundMessage;
    } catch {
      this.handlers.onLog(`Invalid app-server JSON: ${line}`);
      return;
    }

    if ("id" in message && "method" in message) {
      this.handlers.onServerRequest(message);
      return;
    }

    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.handlers.onLog(`Orphan app-server response: ${JSON.stringify(message)}`);
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if ("error" in message && message.error) {
        pending.reject(new Error(message.error.message || "Codex app-server request failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("method" in message) {
      this.handlers.onNotification(message);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
