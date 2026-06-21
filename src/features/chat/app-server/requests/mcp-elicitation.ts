import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  appServerMcpElicitationRequest,
  appServerMcpElicitationResponse,
  type AppServerMcpElicitationResponse,
} from "../../../../app-server/protocol/server-requests";
import type { McpElicitationAction, McpElicitationContentValue, PendingMcpElicitation } from "../../../../domain/pending-requests/model";

export function toPendingMcpElicitation(request: ServerRequest): PendingMcpElicitation | null {
  return appServerMcpElicitationRequest(request);
}

export function mcpElicitationResponse(
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): AppServerMcpElicitationResponse {
  return appServerMcpElicitationResponse(action, content);
}
