import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type {
  ApprovalAction,
  McpElicitationAction,
  McpElicitationContentValue,
  PendingApproval,
  PendingMcpElicitation,
  PendingUserInput,
} from "../../domain/pending-requests/model";
import {
  type ActiveRouteScope,
  type AppServerRouteScope,
  fallbackAppServerRouteScope,
  isAppServerRouteScopeInActiveRouteScope,
  isTurnScopedAppServerRouteForIdlePanelTurn,
} from "./route-scope";
import {
  appServerApprovalDecisionSignature,
  appServerApprovalRequest,
  appServerApprovalResponse,
  appServerMcpElicitationRequest,
  appServerMcpElicitationResponse,
  appServerUserInputRequest,
  appServerUserInputResponse,
} from "./server-request-adapter";

type ApprovalServerRequest = Extract<
  ServerRequest,
  { method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval" }
>;

export type ServerRequestRoute =
  | { kind: "approval"; request: ServerRequest; approval: PendingApproval }
  | { kind: "userInput"; request: ServerRequest; input: PendingUserInput }
  | { kind: "mcpElicitation"; request: ServerRequest; elicitation: PendingMcpElicitation }
  | { kind: "currentTime"; request: Extract<ServerRequest, { method: "currentTime/read" }> }
  | { kind: "dynamicTool"; request: Extract<ServerRequest, { method: "item/tool/call" }> }
  | { kind: "unsupported"; request: ServerRequest }
  | { kind: "unknown"; request: ServerRequest }
  | { kind: "inactive"; request: ServerRequest };

type ServerRequestMethod = ServerRequest["method"];
type ServerRequestDescriptorByMethod = {
  [Method in ServerRequestMethod]: {
    routeKind: Exclude<ServerRequestRoute["kind"], "inactive" | "unknown">;
    scope: (request: Extract<ServerRequest, { method: Method }>) => AppServerRouteScope;
  };
};

const SERVER_REQUEST_DESCRIPTORS = {
  "item/commandExecution/requestApproval": { routeKind: "approval", scope: threadTurnRequestScope },
  "item/fileChange/requestApproval": { routeKind: "approval", scope: threadTurnRequestScope },
  "item/permissions/requestApproval": { routeKind: "approval", scope: threadTurnRequestScope },
  "item/tool/requestUserInput": { routeKind: "userInput", scope: threadTurnRequestScope },
  "mcpServer/elicitation/request": { routeKind: "mcpElicitation", scope: threadTurnRequestScope },
  "item/tool/call": { routeKind: "dynamicTool", scope: threadTurnRequestScope },
  "account/chatgptAuthTokens/refresh": { routeKind: "unsupported", scope: unscopedRequestScope },
  "attestation/generate": { routeKind: "unsupported", scope: unscopedRequestScope },
  "currentTime/read": { routeKind: "currentTime", scope: threadOnlyRequestScope },
  applyPatchApproval: { routeKind: "unsupported", scope: unscopedRequestScope },
  execCommandApproval: { routeKind: "unsupported", scope: unscopedRequestScope },
} satisfies ServerRequestDescriptorByMethod;

interface ServerRequestDescriptor {
  readonly routeKind: Exclude<ServerRequestRoute["kind"], "inactive" | "unknown">;
  readonly scope: (request: ServerRequest) => AppServerRouteScope;
}

export function routeServerRequest(request: ServerRequest, scope: ActiveRouteScope): ServerRequestRoute {
  const routeScope = serverRequestScope(request);
  if (!isServerRequest(request)) {
    if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", request };
    if (isTurnScopedAppServerRouteForIdlePanelTurn(routeScope, scope)) return { kind: "inactive", request };
    return { kind: "unknown", request };
  }
  if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", request };
  if (isTurnScopedAppServerRouteForIdlePanelTurn(routeScope, scope)) return { kind: "inactive", request };

  switch (serverRequestDescriptor(request).routeKind) {
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
    case "dynamicTool":
      return { kind: "dynamicTool", request: request as Extract<ServerRequest, { method: "item/tool/call" }> };
    case "unsupported":
      return { kind: "unsupported", request };
  }
}

export function serverRequestApprovalResponse(request: ApprovalServerRequest, action: ApprovalAction): unknown {
  return appServerApprovalResponse(request, action);
}

export function serverRequestApprovalDecisionSignature(request: ApprovalServerRequest): string {
  return appServerApprovalDecisionSignature(request);
}

export function serverRequestUserInputResponse(questions: readonly { id: string }[], answers: Record<string, string>): unknown {
  return appServerUserInputResponse(questions, answers);
}

export function serverRequestMcpElicitationResponse(
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): unknown {
  return appServerMcpElicitationResponse(action, content);
}

export function serverRequestCurrentTimeResponse(currentTimeMs: number): unknown {
  return { currentTimeAt: Math.floor(currentTimeMs / 1000) };
}

function serverRequestScope(request: ServerRequest): AppServerRouteScope {
  if (!isServerRequest(request)) return fallbackAppServerRouteScope(request);
  return serverRequestDescriptor(request).scope(request);
}

function isServerRequest(request: ServerRequest): boolean {
  return Object.hasOwn(SERVER_REQUEST_DESCRIPTORS, request.method);
}

function serverRequestDescriptor(request: ServerRequest): ServerRequestDescriptor {
  return SERVER_REQUEST_DESCRIPTORS[request.method] as ServerRequestDescriptor;
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
