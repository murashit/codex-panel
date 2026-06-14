import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { CollaborationMode } from "../../generated/app-server/CollaborationMode";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
import type { ConfigReadResponse } from "../../generated/app-server/v2/ConfigReadResponse";
import type { ConfigWriteResponse } from "../../generated/app-server/v2/ConfigWriteResponse";
import type { FsReadFileResponse } from "../../generated/app-server/v2/FsReadFileResponse";
import type { GetAccountRateLimitsResponse } from "../../generated/app-server/v2/GetAccountRateLimitsResponse";
import type { HookTrustStatus } from "../../generated/app-server/v2/HookTrustStatus";
import type { HooksListResponse } from "../../generated/app-server/v2/HooksListResponse";
import type { CollaborationModeListResponse } from "../../generated/app-server/v2/CollaborationModeListResponse";
import type { ListMcpServerStatusParams } from "../../generated/app-server/v2/ListMcpServerStatusParams";
import type { ListMcpServerStatusResponse } from "../../generated/app-server/v2/ListMcpServerStatusResponse";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import type { ModelProviderCapabilitiesReadResponse } from "../../generated/app-server/v2/ModelProviderCapabilitiesReadResponse";
import type { SkillsListResponse } from "../../generated/app-server/v2/SkillsListResponse";
import type { ThreadArchiveResponse } from "../../generated/app-server/v2/ThreadArchiveResponse";
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
import type { ThreadCompactStartResponse } from "../../generated/app-server/v2/ThreadCompactStartResponse";
import type { SortDirection } from "../../generated/app-server/v2/SortDirection";
import type { ThreadStartResponse } from "../../generated/app-server/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "../../generated/app-server/v2/ThreadTurnsListResponse";
import type { ThreadUnarchiveResponse } from "../../generated/app-server/v2/ThreadUnarchiveResponse";
import type { TurnItemsView } from "../../generated/app-server/v2/TurnItemsView";
import type { TurnInterruptResponse } from "../../generated/app-server/v2/TurnInterruptResponse";
import type { TurnStartResponse } from "../../generated/app-server/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../../generated/app-server/v2/TurnSteerResponse";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import { CLIENT_VERSION } from "../../constants";
import { StdioAppServerTransport, type AppServerTransport, type AppServerTransportHandlers } from "./transport";
import type {
  ClientRequestMethod,
  ClientRequestParams,
  PendingRequest,
  RpcError,
  RpcInboundMessage,
  RpcOutboundMessage,
} from "./rpc-messages";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { CodexInput } from "../../domain/chat/input";
import { toAppServerUserInput } from "../protocol/request-input";
import { appServerThreadGoalUpdate, type ThreadGoalUpdate } from "../protocol/thread-goal";
import { appServerRuntimeSettingsPatch, type RuntimeServiceTierRequest, type RuntimeSettingsPatch } from "../protocol/thread-settings";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_SUPPRESSED_ORPHAN_RESPONSES = 256;

export interface AppServerClientHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export type AppServerTransportFactory = (handlers: AppServerTransportHandlers) => AppServerTransport;

export interface AppServerHookOperation {
  key: string;
  currentHash: string;
  trustStatus: HookTrustStatus;
}

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

class AppServerRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  readonly method: ClientRequestMethod;

  constructor(method: ClientRequestMethod, error: RpcError) {
    super(error.message || "Codex app-server request failed.");
    this.name = "AppServerRpcError";
    if (error.code !== undefined) this.code = error.code;
    this.data = error.data;
    this.method = method;
  }
}

function isRpcError(value: unknown): value is RpcError {
  return value !== null && typeof value === "object" && typeof (value as { message?: unknown }).message === "string";
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
  "thread/unarchive": ThreadUnarchiveResponse;
  "thread/rollback": ThreadRollbackResponse;
  "thread/name/set": ThreadSetNameResponse;
  "thread/settings/update": ThreadSettingsUpdateResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "skills/list": SkillsListResponse;
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
  private nextId = 1;
  private pending = new Map<RequestId, PendingRequest>();
  private suppressedOrphanResponses = new Set<RequestId>();

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerClientHandlers,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly transportFactory?: AppServerTransportFactory,
  ) {}

  async connect(): Promise<InitializeResponse> {
    if (this.activeTransport()?.isRunning()) {
      throw new Error("Codex app-server is already running.");
    }

    const transportHandlers: AppServerTransportHandlers = {
      onLine: (line) => {
        this.handleLine(line);
      },
      onLog: this.handlers.onLog,
      onError: (error) => {
        this.rejectAll(error);
      },
      onExit: (code, signal) => {
        this.lifecycle = { kind: "disconnected" };
        this.rejectAll(new Error(`Codex app-server exited: ${String(code ?? signal ?? "unknown")}`));
        this.handlers.onExit(code, signal);
      },
    };
    const transport = this.transportFactory
      ? this.transportFactory(transportHandlers)
      : new StdioAppServerTransport(this.codexPath, this.cwd, transportHandlers);
    this.lifecycle = { kind: "starting", transport };
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
  }

  disconnect(): void {
    this.activeTransport()?.stop();
    this.lifecycle = { kind: "disconnected" };
    this.rejectAll(new Error("Codex app-server disconnected."));
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
      sortKey: "updated_at",
      sortDirection: "desc",
    });
  }

  archiveThread(threadId: string): Promise<ThreadArchiveResponse> {
    return this.request("thread/archive", { threadId });
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
    const params: ClientRequestParams<"turn/start"> = {
      threadId,
      cwd,
      ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
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
    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: toUserInput(input),
      ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
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
    this.send({ id: requestId, result });
  }

  rejectServerRequest(requestId: RequestId, code: number, message: string): void {
    this.send({ id: requestId, error: { code, message } });
  }

  private request<M extends TypedClientRequestMethod>(
    method: M,
    params: ClientRequestParams<M>,
    options: { timeoutMs?: number } = {},
  ): Promise<ClientResponseByMethod[M]> {
    const id = this.nextId++;
    const promise = new Promise<ClientResponseByMethod[M]>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        this.suppressOrphanResponse(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, options.timeoutMs ?? this.requestTimeoutMs);
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
    const transport = this.activeTransport();
    if (!transport?.isRunning()) {
      throw new Error("Codex app-server is not running.");
    }
    transport.send(message);
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
        if (this.suppressedOrphanResponses.delete(message.id)) return;
        this.handlers.onLog(`Orphan app-server response: ${JSON.stringify(message)}`);
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if ("error" in message) {
        if (!isRpcError(message.error)) {
          pending.reject(new Error(`Codex app-server returned an invalid error response for ${pending.method}.`));
          return;
        }
        pending.reject(new AppServerRpcError(pending.method, message.error));
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
    this.suppressedOrphanResponses.clear();
  }

  private suppressOrphanResponse(id: RequestId): void {
    this.suppressedOrphanResponses.add(id);
    while (this.suppressedOrphanResponses.size > MAX_SUPPRESSED_ORPHAN_RESPONSES) {
      for (const oldest of this.suppressedOrphanResponses) {
        this.suppressedOrphanResponses.delete(oldest);
        break;
      }
    }
  }

  private activeTransport(): AppServerTransport | null {
    return this.lifecycle.kind === "disconnected" ? null : this.lifecycle.transport;
  }
}
