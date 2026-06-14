import type {
  ClientRequestMethod,
  ClientRequestParams,
  PendingRequest,
  RpcError,
  RpcInboundMessage,
  RpcOutboundMessage,
} from "./rpc-messages";
import type { ServerNotification, ServerRequest } from "./rpc-messages";
import type { RequestId } from "../../generated/app-server/RequestId";

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

    let message: RpcInboundMessage;
    try {
      message = JSON.parse(line) as RpcInboundMessage;
    } catch {
      this.options.onLog(`Invalid app-server JSON: ${line}`);
      return;
    }

    if ("id" in message && "method" in message) {
      this.options.onServerRequest(message);
      return;
    }

    if ("id" in message) {
      this.handleResponse(message);
      return;
    }

    if ("method" in message) {
      this.options.onNotification(message);
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

function isRpcError(value: unknown): value is RpcError {
  return value !== null && typeof value === "object" && typeof (value as { message?: unknown }).message === "string";
}
