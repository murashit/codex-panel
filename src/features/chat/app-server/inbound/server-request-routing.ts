import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { CurrentTimeReadResponse } from "../../../../generated/app-server/v2/CurrentTimeReadResponse";
import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../domain/pending-requests/model";
import {
  type ActiveRouteScope,
  type AppServerRouteScope,
  fallbackAppServerRouteScope,
  isAppServerRouteScopeInActiveRouteScope,
  isTurnScopedAppServerRouteForIdlePanelTurn,
} from "./route-scope";
import {
  type ApprovalRequest,
  appServerApprovalRequest,
  appServerMcpElicitationRequest,
  appServerUserInputRequest,
} from "./server-request-adapter";

export type ServerRequestRoute =
  | { kind: "approval"; request: ApprovalRequest; approval: PendingApproval }
  | { kind: "userInput"; request: Extract<ServerRequest, { method: "item/tool/requestUserInput" }>; input: PendingUserInput }
  | {
      kind: "mcpElicitation";
      request: Extract<ServerRequest, { method: "mcpServer/elicitation/request" }>;
      elicitation: PendingMcpElicitation;
    }
  | { kind: "currentTime"; request: Extract<ServerRequest, { method: "currentTime/read" }> }
  | { kind: "dynamicTool"; request: Extract<ServerRequest, { method: "item/tool/call" }> }
  | { kind: "unsupported"; request: ServerRequest }
  | { kind: "unknown"; request: ServerRequest }
  | { kind: "inactive"; request: ServerRequest };

export function routeServerRequest(request: ServerRequest, scope: ActiveRouteScope): ServerRequestRoute {
  const routeScope = serverRequestScope(request);
  if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", request };
  if (isTurnScopedAppServerRouteForIdlePanelTurn(routeScope, scope)) return { kind: "inactive", request };

  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval": {
      const approval = appServerApprovalRequest(request);
      if (approval) return { kind: "approval", request, approval };
      return { kind: "unsupported", request };
    }
    case "item/tool/requestUserInput": {
      const input = appServerUserInputRequest(request);
      if (input) return { kind: "userInput", request, input };
      return { kind: "unsupported", request };
    }
    case "mcpServer/elicitation/request": {
      const elicitation = appServerMcpElicitationRequest(request);
      if (elicitation) return { kind: "mcpElicitation", request, elicitation };
      return { kind: "unsupported", request };
    }
    case "currentTime/read":
      return { kind: "currentTime", request };
    case "item/tool/call":
      return { kind: "dynamicTool", request };
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
    case "applyPatchApproval":
    case "execCommandApproval":
      return { kind: "unsupported", request };
    default: {
      const unknownRequest: never = request;
      return { kind: "unknown", request: unknownRequest };
    }
  }
}

export function serverRequestCurrentTimeResponse(currentTimeMs: number): CurrentTimeReadResponse {
  return { currentTimeAt: Math.floor(currentTimeMs / 1000) };
}

function serverRequestScope(request: ServerRequest): AppServerRouteScope {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
    case "item/tool/call":
      return threadTurnRequestScope(request);
    case "currentTime/read":
      return threadOnlyRequestScope(request);
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
    case "applyPatchApproval":
    case "execCommandApproval":
      return unscopedRequestScope();
    default: {
      const unknownRequest: never = request;
      return fallbackAppServerRouteScope(unknownRequest);
    }
  }
}

function threadTurnRequestScope(request: { params: { threadId: string; turnId: string | null } }): AppServerRouteScope {
  return { threadId: request.params.threadId, turnId: request.params.turnId };
}

function threadOnlyRequestScope(request: { params: { threadId: string | null } }): AppServerRouteScope {
  return { threadId: request.params.threadId, turnId: null };
}

function unscopedRequestScope(): AppServerRouteScope {
  return { threadId: null, turnId: null };
}
