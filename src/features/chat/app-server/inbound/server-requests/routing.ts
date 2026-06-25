import type { ServerRequest } from "../../../../../app-server/connection/rpc-messages";
import {
  appServerApprovalRequest,
  appServerMcpElicitationRequest,
  appServerUserInputRequest,
} from "../../../../../app-server/protocol/server-requests";
import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../../../../domain/pending-requests/model";
import {
  type ActiveRouteScope,
  fallbackMessageScope,
  isMessageScopeInActiveRouteScope,
  isTurnScopedMessageForIdleActiveThread,
  type MessageScope,
} from "../route-scope";

export type ServerRequestRoute =
  | { kind: "approval"; request: ServerRequest; approval: PendingApproval }
  | { kind: "userInput"; request: ServerRequest; input: PendingUserInput }
  | { kind: "mcpElicitation"; request: ServerRequest; elicitation: PendingMcpElicitation }
  | { kind: "currentTime"; request: Extract<ServerRequest, { method: "currentTime/read" }> }
  | { kind: "unsupported"; request: ServerRequest }
  | { kind: "unknown"; request: ServerRequest }
  | { kind: "inactive"; request: ServerRequest };

type ServerRequestMethod = ServerRequest["method"];
type ServerRequestRouteKindByMethod = Record<ServerRequestMethod, Exclude<ServerRequestRoute["kind"], "inactive" | "unknown">>;
type ServerRequestScopeExtractors = {
  [Method in ServerRequestMethod]: (request: Extract<ServerRequest, { method: Method }>) => MessageScope;
};

const SERVER_REQUEST_SCOPE_EXTRACTORS: ServerRequestScopeExtractors = {
  "item/commandExecution/requestApproval": threadTurnRequestScope,
  "item/fileChange/requestApproval": threadTurnRequestScope,
  "item/tool/requestUserInput": threadTurnRequestScope,
  "mcpServer/elicitation/request": threadTurnRequestScope,
  "item/permissions/requestApproval": threadTurnRequestScope,
  "item/tool/call": threadTurnRequestScope,
  "account/chatgptAuthTokens/refresh": unscopedRequestScope,
  "attestation/generate": unscopedRequestScope,
  "currentTime/read": threadOnlyRequestScope,
  applyPatchApproval: unscopedRequestScope,
  execCommandApproval: unscopedRequestScope,
};

const SERVER_REQUEST_ROUTE_KIND_BY_METHOD: ServerRequestRouteKindByMethod = {
  "item/commandExecution/requestApproval": "approval",
  "item/fileChange/requestApproval": "approval",
  "item/permissions/requestApproval": "approval",
  "item/tool/requestUserInput": "userInput",
  "mcpServer/elicitation/request": "mcpElicitation",
  "item/tool/call": "unsupported",
  "account/chatgptAuthTokens/refresh": "unsupported",
  "attestation/generate": "unsupported",
  "currentTime/read": "currentTime",
  applyPatchApproval: "unsupported",
  execCommandApproval: "unsupported",
};

export function routeServerRequest(request: ServerRequest, scope: ActiveRouteScope): ServerRequestRoute {
  const messageScope = serverRequestScope(request);
  if (!isServerRequest(request)) {
    if (!isMessageScopeInActiveRouteScope(messageScope, scope)) return { kind: "inactive", request };
    if (isTurnScopedMessageForIdleActiveThread(messageScope, scope)) return { kind: "inactive", request };
    return { kind: "unknown", request };
  }
  if (!isMessageScopeInActiveRouteScope(messageScope, scope)) return { kind: "inactive", request };
  if (isTurnScopedMessageForIdleActiveThread(messageScope, scope)) return { kind: "inactive", request };

  switch (SERVER_REQUEST_ROUTE_KIND_BY_METHOD[request.method]) {
    case "approval": {
      const approval = appServerApprovalRequest(request);
      if (approval) return { kind: "approval", request, approval };
      return { kind: "unsupported", request };
    }
    case "userInput": {
      const input = appServerUserInputRequest(request);
      if (input) return { kind: "userInput", request, input };
      return { kind: "unsupported", request };
    }
    case "mcpElicitation": {
      const elicitation = appServerMcpElicitationRequest(request);
      if (elicitation) return { kind: "mcpElicitation", request, elicitation };
      return { kind: "unsupported", request };
    }
    case "currentTime":
      return { kind: "currentTime", request: request as Extract<ServerRequest, { method: "currentTime/read" }> };
    case "unsupported":
      return { kind: "unsupported", request };
  }
}

function serverRequestScope(request: ServerRequest): MessageScope {
  if (!isServerRequest(request)) return fallbackMessageScope(request);
  const extractor = SERVER_REQUEST_SCOPE_EXTRACTORS[request.method] as (request: ServerRequest) => MessageScope;
  return extractor(request);
}

function isServerRequest(request: ServerRequest): boolean {
  return Object.hasOwn(SERVER_REQUEST_SCOPE_EXTRACTORS, request.method);
}

function threadTurnRequestScope(request: { params: { threadId: string; turnId: string | null } }): MessageScope {
  return { threadId: request.params.threadId, turnId: request.params.turnId };
}

function threadOnlyRequestScope(request: { params: { threadId: string | null } }): MessageScope {
  return { threadId: request.params.threadId, turnId: null };
}

function unscopedRequestScope(): MessageScope {
  return { threadId: null, turnId: null };
}
