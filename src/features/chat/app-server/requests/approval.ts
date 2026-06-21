import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  appServerApprovalRequest,
  appServerApprovalResponse,
  type AppServerApprovalResponse,
} from "../../../../app-server/protocol/server-requests";
import type { ApprovalAction, PendingApproval } from "../../../../domain/pending-requests/model";

export function toPendingApproval(request: ServerRequest): PendingApproval | null {
  return appServerApprovalRequest(request);
}

export function approvalResponse(approval: PendingApproval, action: ApprovalAction): AppServerApprovalResponse {
  return appServerApprovalResponse(approval, action);
}
