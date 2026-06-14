import type {
  ApprovalAction,
  CommandApprovalDecision,
  CommandApprovalParams,
  FileChangeApprovalParams,
  PendingApproval,
  PendingRequestId,
  PermissionProfile,
  PermissionsApprovalParams,
} from "../../domain/pending-requests/model";
import { isCommandDecisionAction } from "../../domain/pending-requests/model";

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

interface ApprovalRequestLike {
  id: PendingRequestId;
  method: string;
  params: unknown;
}

type ApprovalRequest = CommandApprovalRequest | FileChangeApprovalRequest | PermissionsApprovalRequest;
interface CommandApprovalRequest extends ApprovalRequestLike {
  method: "item/commandExecution/requestApproval";
  params: CommandApprovalParams;
}
interface FileChangeApprovalRequest extends ApprovalRequestLike {
  method: "item/fileChange/requestApproval";
  params: FileChangeApprovalParams;
}
interface PermissionsApprovalRequest extends ApprovalRequestLike {
  method: "item/permissions/requestApproval";
  params: PermissionsApprovalParams;
}

interface GrantedPermissionProfile {
  network?: PermissionProfile["network"];
  fileSystem?: PermissionProfile["fileSystem"];
}

type ApprovalResponse =
  | { decision: CommandApprovalDecision }
  | { decision: SimpleApprovalDecision }
  | { scope: "session" | "turn"; permissions: GrantedPermissionProfile };

export function toPendingApproval(request: ApprovalRequestLike): PendingApproval | null {
  if (!isApprovalRequest(request)) return null;
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return pendingApproval(request);
    case "item/fileChange/requestApproval":
      return pendingApproval(request);
    case "item/permissions/requestApproval":
      return pendingApproval(request);
  }
}

function isApprovalRequest(request: ApprovalRequestLike): request is ApprovalRequest {
  return (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "item/permissions/requestApproval"
  );
}

function pendingApproval(request: CommandApprovalRequest): Extract<PendingApproval, { method: CommandApprovalRequest["method"] }>;
function pendingApproval(request: FileChangeApprovalRequest): Extract<PendingApproval, { method: FileChangeApprovalRequest["method"] }>;
function pendingApproval(request: PermissionsApprovalRequest): Extract<PendingApproval, { method: PermissionsApprovalRequest["method"] }>;
function pendingApproval(request: ApprovalRequest): PendingApproval {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      };
    case "item/fileChange/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      };
    case "item/permissions/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      };
  }
}

export function approvalResponse(approval: PendingApproval, action: ApprovalAction): ApprovalResponse {
  if (approval.method === "item/commandExecution/requestApproval") {
    return {
      decision: isCommandDecisionAction(action) ? action.decision : commandDecision(action),
    };
  }

  if (approval.method === "item/fileChange/requestApproval") {
    return {
      decision: fileChangeDecision(action),
    };
  }

  return {
    scope: action === "accept-session" ? "session" : "turn",
    permissions: action === "accept" || action === "accept-session" ? grantedPermissions(approval.params.permissions) : {},
  };
}

function commandDecision(action: ApprovalAction): CommandApprovalDecision {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function fileChangeDecision(action: ApprovalAction): SimpleApprovalDecision {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function grantedPermissions(requested: PermissionsApprovalParams["permissions"]): GrantedPermissionProfile {
  const granted: GrantedPermissionProfile = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}
