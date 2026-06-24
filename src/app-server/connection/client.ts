import { CLIENT_VERSION } from "../../constants";
import type { CodexInput } from "../../domain/chat/input";
import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../domain/runtime/thread-settings";
import type { ThreadGoalUpdate } from "../../domain/threads/goal";
import type { CollaborationMode } from "../../generated/app-server/CollaborationMode";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
import type { AppsListParams } from "../../generated/app-server/v2/AppsListParams";
import type { AppsListResponse } from "../../generated/app-server/v2/AppsListResponse";
import type { CollaborationModeListResponse } from "../../generated/app-server/v2/CollaborationModeListResponse";
import type { ConfigReadResponse } from "../../generated/app-server/v2/ConfigReadResponse";
import type { ConfigWriteResponse } from "../../generated/app-server/v2/ConfigWriteResponse";
import type { FsReadFileResponse } from "../../generated/app-server/v2/FsReadFileResponse";
import type { GetAccountRateLimitsResponse } from "../../generated/app-server/v2/GetAccountRateLimitsResponse";
import type { HooksListResponse } from "../../generated/app-server/v2/HooksListResponse";
import type { ListMcpServerStatusParams } from "../../generated/app-server/v2/ListMcpServerStatusParams";
import type { ListMcpServerStatusResponse } from "../../generated/app-server/v2/ListMcpServerStatusResponse";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import type { ModelProviderCapabilitiesReadResponse } from "../../generated/app-server/v2/ModelProviderCapabilitiesReadResponse";
import type { PluginInstalledParams } from "../../generated/app-server/v2/PluginInstalledParams";
import type { PluginInstalledResponse } from "../../generated/app-server/v2/PluginInstalledResponse";
import type { PluginReadParams } from "../../generated/app-server/v2/PluginReadParams";
import type { PluginReadResponse } from "../../generated/app-server/v2/PluginReadResponse";
import type { SkillsListResponse } from "../../generated/app-server/v2/SkillsListResponse";
import type { SortDirection } from "../../generated/app-server/v2/SortDirection";
import type { ThreadArchiveResponse } from "../../generated/app-server/v2/ThreadArchiveResponse";
import type { ThreadCompactStartResponse } from "../../generated/app-server/v2/ThreadCompactStartResponse";
import type { ThreadDeleteResponse } from "../../generated/app-server/v2/ThreadDeleteResponse";
import type { ThreadForkResponse } from "../../generated/app-server/v2/ThreadForkResponse";
import type { ThreadGoalClearResponse } from "../../generated/app-server/v2/ThreadGoalClearResponse";
import type { ThreadGoalGetResponse } from "../../generated/app-server/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetResponse } from "../../generated/app-server/v2/ThreadGoalSetResponse";
import type { ThreadInjectItemsResponse } from "../../generated/app-server/v2/ThreadInjectItemsResponse";
import type { ThreadListResponse } from "../../generated/app-server/v2/ThreadListResponse";
import type { ThreadReadResponse } from "../../generated/app-server/v2/ThreadReadResponse";
import type { ThreadResumeResponse } from "../../generated/app-server/v2/ThreadResumeResponse";
import type { ThreadRollbackResponse } from "../../generated/app-server/v2/ThreadRollbackResponse";
import type { ThreadSetNameResponse } from "../../generated/app-server/v2/ThreadSetNameResponse";
import type { ThreadSettingsUpdateResponse } from "../../generated/app-server/v2/ThreadSettingsUpdateResponse";
import type { ThreadStartResponse } from "../../generated/app-server/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "../../generated/app-server/v2/ThreadTurnsListResponse";
import type { ThreadUnarchiveResponse } from "../../generated/app-server/v2/ThreadUnarchiveResponse";
import type { TurnInterruptResponse } from "../../generated/app-server/v2/TurnInterruptResponse";
import type { TurnItemsView } from "../../generated/app-server/v2/TurnItemsView";
import type { TurnStartResponse } from "../../generated/app-server/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../../generated/app-server/v2/TurnSteerResponse";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import type { AppServerHookOperation } from "../protocol/catalog";
import { additionalContextFromCodexInput, toAppServerUserInput } from "../protocol/request-input";
import { appServerThreadGoalUpdate } from "../protocol/thread-goal";
import { appServerRuntimeSettingsPatch } from "../protocol/thread-settings";
import { JsonRpcClient } from "./json-rpc-client";
import type { ClientRequestMethod, ClientRequestParams, RpcOutboundMessage } from "./rpc-messages";
import { type AppServerTransport, type AppServerTransportHandlers, StdioAppServerTransport } from "./transport";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface AppServerClientHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export type AppServerTransportFactory = (handlers: AppServerTransportHandlers) => AppServerTransport;

interface AppServerTurnRuntimeOverrides {
  serviceTier?: RuntimeServiceTierRequest;
  collaborationMode?: CollaborationMode;
  model?: string | null;
  effort?: ReasoningEffort | null;
  approvalsReviewer?: ApprovalsReviewer | null;
}

type AppServerTurnRuntimeParams = Pick<
  ClientRequestParams<"turn/start">,
  "serviceTier" | "collaborationMode" | "model" | "effort" | "approvalsReviewer"
>;

export interface AppServerStartThreadOptions {
  cwd: string;
  serviceTier?: RuntimeServiceTierRequest;
}

export interface AppServerThreadListOptions {
  archived?: boolean;
  cursor?: string | null;
  limit?: number | null;
}

export interface AppServerStartEphemeralThreadOptions {
  cwd: string;
  serviceName: string;
  developerInstructions: string;
}

export interface AppServerStartTurnOptions {
  threadId: string;
  cwd: string;
  input: string | CodexInput;
  clientUserMessageId?: string | null;
  runtime?: AppServerTurnRuntimeOverrides;
}

export interface AppServerStartStructuredTurnOptions {
  threadId: string;
  cwd: string;
  text: string;
  outputSchema: JsonValue;
  runtime?: AppServerTurnRuntimeOverrides;
}

interface ClientResponseByMethod {
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
  "thread/unarchive": ThreadUnarchiveResponse;
  "thread/rollback": ThreadRollbackResponse;
  "thread/name/set": ThreadSetNameResponse;
  "thread/settings/update": ThreadSettingsUpdateResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "skills/list": SkillsListResponse;
  "app/list": AppsListResponse;
  "plugin/installed": PluginInstalledResponse;
  "plugin/read": PluginReadResponse;
  "model/list": ModelListResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "collaborationMode/list": CollaborationModeListResponse;
  "modelProvider/capabilities/read": ModelProviderCapabilitiesReadResponse;
  "thread/compact/start": ThreadCompactStartResponse;
  "turn/start": TurnStartResponse;
  "turn/steer": TurnSteerResponse;
  "turn/interrupt": TurnInterruptResponse;
  "fs/readFile": FsReadFileResponse;
}

type TypedClientRequestMethod = Extract<ClientRequestMethod, keyof ClientResponseByMethod>;

type AppServerClientLifecycleState =
  | { kind: "disconnected" }
  | { kind: "starting"; transport: AppServerTransport }
  | { kind: "initialized"; transport: AppServerTransport; initializeResponse: InitializeResponse };

function toUserInput(input: string | CodexInput): UserInput[] {
  if (typeof input !== "string") return toAppServerUserInput(input);
  return toAppServerUserInput([{ type: "text", text: input }]);
}

function toAdditionalContext(input: string | CodexInput): ClientRequestParams<"turn/start">["additionalContext"] | undefined {
  if (typeof input === "string") return undefined;
  return additionalContextFromCodexInput(input);
}

function appServerTurnRuntimeParams(runtime: AppServerTurnRuntimeOverrides | undefined): AppServerTurnRuntimeParams {
  const params: AppServerTurnRuntimeParams = {};
  if (runtime?.serviceTier !== undefined) params.serviceTier = runtime.serviceTier;
  if (runtime?.collaborationMode !== undefined) params.collaborationMode = runtime.collaborationMode;
  if (runtime?.model !== undefined) params.model = runtime.model;
  if (runtime?.effort !== undefined) params.effort = runtime.effort;
  if (runtime?.approvalsReviewer !== undefined) params.approvalsReviewer = runtime.approvalsReviewer;
  return params;
}

export class AppServerClient {
  private lifecycle: AppServerClientLifecycleState = { kind: "disconnected" };
  private readonly rpc: JsonRpcClient;
  private readonly intentionallyStoppedTransports = new WeakSet<AppServerTransport>();

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerClientHandlers,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly transportFactory?: AppServerTransportFactory,
  ) {
    this.rpc = new JsonRpcClient({
      requestTimeoutMs: this.requestTimeoutMs,
      send: (message) => {
        this.send(message);
      },
      onNotification: this.handlers.onNotification,
      onServerRequest: this.handlers.onServerRequest,
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
      const init = await this.request("initialize", {
        clientInfo: {
          name: "obsidian_codex_panel",
          title: "Codex Panel",
          version: CLIENT_VERSION,
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      });
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

  readEffectiveConfig(cwd: string): Promise<ConfigReadResponse> {
    return this.request("config/read", { cwd, includeLayers: true });
  }

  listHooks(cwd: string): Promise<HooksListResponse> {
    return this.request("hooks/list", { cwds: [cwd] });
  }

  trustHook(hook: AppServerHookOperation): Promise<ConfigWriteResponse> {
    return this.writeHookState(hook.key, {
      enabled: true,
      trusted_hash: hook.currentHash,
    });
  }

  setHookEnabled(hook: AppServerHookOperation, enabled: boolean): Promise<ConfigWriteResponse> {
    const state: Record<string, JsonValue> = hook.trustStatus === "trusted" ? { enabled, trusted_hash: hook.currentHash } : { enabled };
    return this.writeHookState(hook.key, state);
  }

  startThread(options: AppServerStartThreadOptions): Promise<ThreadStartResponse> {
    const { cwd, serviceTier } = options;
    return this.request("thread/start", {
      cwd,
      serviceName: "codex-panel",
      ...(serviceTier !== undefined ? { serviceTier } : {}),
    });
  }

  startEphemeralThread(options: AppServerStartEphemeralThreadOptions): Promise<ThreadStartResponse> {
    const { cwd, serviceName, developerInstructions } = options;
    return this.request("thread/start", {
      cwd,
      serviceName,
      developerInstructions,
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      multiAgentMode: "none",
      environments: [],
    });
  }

  resumeThread(threadId: string, cwd: string): Promise<ThreadResumeResponse> {
    return this.request("thread/resume", {
      threadId,
      cwd,
      excludeTurns: true,
      initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
    });
  }

  forkThread(threadId: string, cwd: string): Promise<ThreadForkResponse> {
    return this.request("thread/fork", {
      threadId,
      cwd,
      excludeTurns: true,
    });
  }

  listThreads(cwd: string, options: AppServerThreadListOptions = {}): Promise<ThreadListResponse> {
    return this.request("thread/list", {
      cwd,
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      archived: options.archived ?? false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  }

  archiveThread(threadId: string): Promise<ThreadArchiveResponse> {
    return this.request("thread/archive", { threadId });
  }

  deleteThread(threadId: string): Promise<ThreadDeleteResponse> {
    return this.request("thread/delete", { threadId });
  }

  readThread(threadId: string, includeTurns = true): Promise<ThreadReadResponse> {
    return this.request("thread/read", { threadId, includeTurns });
  }

  readFile(path: string, options: { timeoutMs?: number } = {}): Promise<FsReadFileResponse> {
    return this.request("fs/readFile", { path }, options);
  }

  unarchiveThread(threadId: string): Promise<ThreadUnarchiveResponse> {
    return this.request("thread/unarchive", { threadId });
  }

  rollbackThread(threadId: string, numTurns = 1): Promise<ThreadRollbackResponse> {
    return this.request("thread/rollback", { threadId, numTurns });
  }

  setThreadName(threadId: string, name: string): Promise<ThreadSetNameResponse> {
    return this.request("thread/name/set", { threadId, name });
  }

  getThreadGoal(threadId: string): Promise<ThreadGoalGetResponse> {
    return this.request("thread/goal/get", { threadId });
  }

  setThreadGoal(threadId: string, params: ThreadGoalUpdate): Promise<ThreadGoalSetResponse> {
    return this.request("thread/goal/set", { threadId, ...appServerThreadGoalUpdate(params) });
  }

  clearThreadGoal(threadId: string): Promise<ThreadGoalClearResponse> {
    return this.request("thread/goal/clear", { threadId });
  }

  injectThreadItems(threadId: string, items: ClientRequestParams<"thread/inject_items">["items"]): Promise<ThreadInjectItemsResponse> {
    return this.request("thread/inject_items", { threadId, items });
  }

  updateThreadSettings(threadId: string, settings: RuntimeSettingsPatch): Promise<ThreadSettingsUpdateResponse> {
    return this.request("thread/settings/update", { threadId, ...appServerRuntimeSettingsPatch(settings) });
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

  listSkills(cwd: string, forceReload = false): Promise<SkillsListResponse> {
    return this.request("skills/list", {
      cwds: [cwd],
      forceReload,
    });
  }

  listApps(params: AppsListParams = { limit: 100 }): Promise<AppsListResponse> {
    return this.request("app/list", params);
  }

  listInstalledPlugins(cwd: string): Promise<PluginInstalledResponse> {
    const params: PluginInstalledParams = { cwds: [cwd] };
    return this.request("plugin/installed", params);
  }

  readPlugin(params: PluginReadParams): Promise<PluginReadResponse> {
    return this.request("plugin/read", params);
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

  listMcpServerStatus(
    params: ListMcpServerStatusParams = { detail: "toolsAndAuthOnly", limit: 100 },
  ): Promise<ListMcpServerStatusResponse> {
    return this.request("mcpServerStatus/list", params);
  }

  listCollaborationModes(): Promise<CollaborationModeListResponse> {
    return this.request("collaborationMode/list", {});
  }

  readModelProviderCapabilities(): Promise<ModelProviderCapabilitiesReadResponse> {
    return this.request("modelProvider/capabilities/read", {});
  }

  compactThread(threadId: string): Promise<ThreadCompactStartResponse> {
    return this.request("thread/compact/start", { threadId });
  }

  startTurn(options: AppServerStartTurnOptions): Promise<TurnStartResponse> {
    const { threadId, cwd, input, clientUserMessageId, runtime } = options;
    const additionalContext = toAdditionalContext(input);
    const params: ClientRequestParams<"turn/start"> = {
      threadId,
      cwd,
      ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
      ...(additionalContext !== undefined ? { additionalContext } : {}),
      ...appServerTurnRuntimeParams(runtime),
      input: toUserInput(input),
    };
    return this.request("turn/start", params);
  }

  startStructuredTurn(options: AppServerStartStructuredTurnOptions): Promise<TurnStartResponse> {
    const { threadId, cwd, text, outputSchema, runtime } = options;
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
      ...appServerTurnRuntimeParams(runtime),
    };
    return this.request("turn/start", params);
  }

  steerTurn(
    threadId: string,
    expectedTurnId: string,
    input: string | CodexInput,
    clientUserMessageId?: string | null,
  ): Promise<TurnSteerResponse> {
    const additionalContext = toAdditionalContext(input);
    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: toUserInput(input),
      ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
      ...(additionalContext !== undefined ? { additionalContext } : {}),
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<TurnInterruptResponse> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  private writeHookState(key: string, state: Record<string, JsonValue>): Promise<ConfigWriteResponse> {
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
    this.rpc.respond(requestId, result);
  }

  rejectServerRequest(requestId: RequestId, code: number, message: string): void {
    this.rpc.reject(requestId, code, message);
  }

  private request<M extends TypedClientRequestMethod>(
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
