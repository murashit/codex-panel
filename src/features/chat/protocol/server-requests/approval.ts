import type { RequestId } from "../../../../app-server/connection/rpc-messages";

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type CommandApprovalDecision =
  | SimpleApprovalDecision
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { action: "allow" | "deny"; [key: string]: unknown } } };

interface ApprovalRequestLike {
  id: RequestId;
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

interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  approvalId?: string | null;
  reason?: string | null;
  networkApprovalContext?: unknown;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  additionalPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[] | null;
  availableDecisions?: CommandApprovalDecision[] | null;
}

interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  grantRoot: string | null;
}

interface PermissionsApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  cwd: string;
  environmentId: string | null;
  permissions: PermissionProfile;
}

interface PermissionProfile {
  network?: { enabled?: boolean | null } | null;
  fileSystem?: {
    entries?: readonly { path: unknown; access?: unknown }[] | null;
    read?: unknown;
    write?: unknown;
    globScanMaxDepth?: unknown;
  } | null;
}
interface GrantedPermissionProfile {
  network?: PermissionProfile["network"];
  fileSystem?: PermissionProfile["fileSystem"];
}

type ApprovalResponse =
  | { decision: CommandApprovalDecision }
  | { decision: SimpleApprovalDecision }
  | { scope: "session" | "turn"; permissions: GrantedPermissionProfile };

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | CommandApprovalDecisionAction;
interface CommandApprovalDecisionAction {
  kind: "command-decision";
  decision: CommandApprovalDecision;
}
type PendingApprovalFor<Request extends ApprovalRequest> = Request extends ApprovalRequest
  ? {
      requestId: RequestId;
      method: Request["method"];
      params: Request["params"];
    }
  : never;
export type PendingApproval = PendingApprovalFor<ApprovalRequest>;

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

function pendingApproval(request: CommandApprovalRequest): PendingApprovalFor<CommandApprovalRequest>;
function pendingApproval(request: FileChangeApprovalRequest): PendingApprovalFor<FileChangeApprovalRequest>;
function pendingApproval(request: PermissionsApprovalRequest): PendingApprovalFor<PermissionsApprovalRequest>;
function pendingApproval(request: ApprovalRequest): PendingApproval {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      } satisfies PendingApprovalFor<CommandApprovalRequest>;
    case "item/fileChange/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      } satisfies PendingApprovalFor<FileChangeApprovalRequest>;
    case "item/permissions/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      } satisfies PendingApprovalFor<PermissionsApprovalRequest>;
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

export function approvalActionKind(action: ApprovalAction): "accept" | "accept-session" | "decline" | "cancel" {
  if (!isCommandDecisionAction(action)) return action;
  const decision = action.decision;
  if (decision === "accept") return "accept";
  if (decision === "acceptForSession") return "accept-session";
  if (decision === "cancel") return "cancel";
  if (decision === "decline") return "decline";
  if ("acceptWithExecpolicyAmendment" in decision) return "accept-session";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "accept-session" : "decline";
  }
  return "decline";
}

function isCommandDecisionAction(action: ApprovalAction): action is CommandApprovalDecisionAction {
  return typeof action === "object";
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
