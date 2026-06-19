import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  appServerApprovalRequest,
  appServerApprovalResponse,
  type AppServerApproval,
  type AppServerApprovalResponse,
} from "../../../../app-server/protocol/server-requests";
import type { ApprovalAction, PendingApproval } from "../../domain/pending-requests/model";

export function toPendingApproval(request: ServerRequest): PendingApproval | null {
  const approval = appServerApprovalRequest(request);
  if (!approval) return null;
  switch (approval.method) {
    case "item/commandExecution/requestApproval":
      return pendingApproval(approval);
    case "item/fileChange/requestApproval":
      return pendingApproval(approval);
    case "item/permissions/requestApproval":
      return pendingApproval(approval);
  }
}

function pendingApproval(
  request: Extract<AppServerApproval, { method: "item/commandExecution/requestApproval" }>,
): Extract<PendingApproval, { method: "item/commandExecution/requestApproval" }>;
function pendingApproval(
  request: Extract<AppServerApproval, { method: "item/fileChange/requestApproval" }>,
): Extract<PendingApproval, { method: "item/fileChange/requestApproval" }>;
function pendingApproval(
  request: Extract<AppServerApproval, { method: "item/permissions/requestApproval" }>,
): Extract<PendingApproval, { method: "item/permissions/requestApproval" }>;
function pendingApproval(request: AppServerApproval): PendingApproval {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        requestId: request.requestId,
        method: request.method,
        params: request.params,
      };
    case "item/fileChange/requestApproval":
      return {
        requestId: request.requestId,
        method: request.method,
        params: request.params,
      };
    case "item/permissions/requestApproval":
      return {
        requestId: request.requestId,
        method: request.method,
        params: request.params,
      };
  }
}

export function approvalResponse(approval: PendingApproval, action: ApprovalAction): AppServerApprovalResponse {
  return appServerApprovalResponse(approval, action);
}
