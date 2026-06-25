import {
  appServerApprovalResponse,
  appServerMcpElicitationResponse,
  appServerUserInputResponse,
} from "../../../../../app-server/protocol/server-requests";
import type {
  ApprovalAction,
  McpElicitationAction,
  McpElicitationContentValue,
  PendingApproval,
} from "../../../../../domain/pending-requests/model";

export function serverRequestApprovalResponse(approval: PendingApproval, action: ApprovalAction): unknown {
  return appServerApprovalResponse(approval, action);
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
