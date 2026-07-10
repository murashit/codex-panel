import type { RequestId } from "../../generated/app-server/RequestId";
import type {
  ClientRequestMethod,
  ClientRequestParams,
  PendingRequest,
  RpcError,
  RpcInboundMessage,
  RpcOutboundMessage,
  ServerNotification,
  ServerRequest,
} from "./rpc-messages";

const MAX_SUPPRESSED_ORPHAN_RESPONSES = 256;

interface RpcResponseMessage {
  id: RequestId;
  result?: unknown;
  error?: RpcError;
}

interface JsonRpcClientHandlers {
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => void;
  onLog: (message: string) => void;
}

export interface JsonRpcClientOptions extends JsonRpcClientHandlers {
  requestTimeoutMs: number;
  send(message: RpcOutboundMessage): void;
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

export class JsonRpcClient {
  private nextId = 1;
  private pending = new Map<RequestId, PendingRequest>();
  private suppressedOrphanResponses = new Set<RequestId>();

  constructor(private readonly options: JsonRpcClientOptions) {}

  request<M extends ClientRequestMethod, R>(
    method: M,
    params: ClientRequestParams<M>,
    requestOptions: { timeoutMs?: number } = {},
  ): Promise<R> {
    const id = this.nextId++;
    const promise = new Promise<R>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        this.suppressOrphanResponse(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, requestOptions.timeoutMs ?? this.options.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
    });

    try {
      this.options.send({ id, method, params } as RpcOutboundMessage);
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

  notify(message: RpcOutboundMessage): void {
    this.options.send(message);
  }

  respond(requestId: RequestId, result: unknown): void {
    this.options.send({ id: requestId, result });
  }

  reject(requestId: RequestId, code: number, message: string): void {
    this.options.send({ id: requestId, error: { code, message } });
  }

  handleLine(line: string): void {
    if (line.trim().length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.options.onLog(`Invalid app-server JSON: ${line}`);
      return;
    }

    const message = rpcInboundMessage(parsed);
    if (!message) {
      this.options.onLog(`Invalid app-server JSON-RPC message: ${line}`);
      return;
    }

    if ("id" in message && "method" in message) {
      try {
        this.options.onServerRequest(message);
      } catch (error) {
        this.options.onLog(`App-server request handler failed: ${errorMessage(error)}`);
        this.reject(message.id, -32603, "Codex Panel failed to handle the app-server request.");
      }
      return;
    }

    if ("id" in message) {
      this.handleResponse(message);
      return;
    }

    if ("method" in message) {
      try {
        this.options.onNotification(message);
      } catch (error) {
        this.options.onLog(`App-server notification handler failed: ${errorMessage(error)}`);
      }
    }
  }

  rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.suppressedOrphanResponses.clear();
  }

  private handleResponse(message: RpcResponseMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      if (this.suppressedOrphanResponses.delete(message.id)) return;
      this.options.onLog(`Orphan app-server response: ${JSON.stringify(message)}`);
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
}

function rpcInboundMessage(value: unknown): RpcInboundMessage | null {
  if (!isRecord(value)) return null;
  const hasId = Object.hasOwn(value, "id");
  const hasMethod = Object.hasOwn(value, "method");
  if (hasId && !isRequestId(value["id"])) return null;
  if (hasMethod && (typeof value["method"] !== "string" || value["method"].length === 0 || !isRecord(value["params"]))) return null;
  if (hasId && hasMethod) return value as unknown as ServerRequest;
  if (hasId) {
    const hasResult = Object.hasOwn(value, "result");
    const hasError = Object.hasOwn(value, "error");
    return hasResult !== hasError ? (value as unknown as RpcInboundMessage) : null;
  }
  return hasMethod ? (value as unknown as ServerNotification) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRpcError(value: unknown): value is RpcError {
  return value !== null && typeof value === "object" && typeof (value as { message?: unknown }).message === "string";
}
