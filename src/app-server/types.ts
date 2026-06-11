import type { ClientNotification } from "../generated/app-server/ClientNotification";
import type { ClientRequest } from "../generated/app-server/ClientRequest";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";

export type { RequestId, ServerNotification, ServerRequest };

export type ClientRequestMethod = ClientRequest["method"];
export type ClientRequestParams<M extends ClientRequestMethod> = Extract<ClientRequest, { method: M }>["params"];

export interface RpcError {
  code?: number;
  message: string;
  data?: unknown;
}

export type RpcOutboundMessage =
  | ClientRequest
  | ClientNotification
  | { id: RequestId; result: unknown }
  | { id: RequestId; error: RpcError };

export type RpcInboundMessage = ServerNotification | ServerRequest | { id: RequestId; result?: unknown; error?: RpcError };

export interface PendingRequest {
  method: ClientRequestMethod;
  reject: (reason: Error) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<Window["setTimeout"]>;
}
