import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import type { CommandExecutionRequestApprovalResponse } from "../generated/app-server/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalResponse } from "../generated/app-server/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "../generated/app-server/v2/GrantedPermissionProfile";
import type { PermissionsRequestApprovalResponse } from "../generated/app-server/v2/PermissionsRequestApprovalResponse";
import { jsonPreview } from "../utils";

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel";
export type ApprovalRequest = Extract<
  ServerRequest,
  {
    method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval";
  }
>;

export type PendingApproval = ApprovalRequest extends infer Request
  ? Request extends ApprovalRequest
    ? {
        requestId: RequestId;
        method: Request["method"];
        params: Request["params"];
      }
    : never
  : never;

export function toPendingApproval(request: ServerRequest): PendingApproval | null {
  if (!isApprovalRequest(request)) return null;
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      } as PendingApproval;
  }
}

export function isApprovalRequest(request: ServerRequest): request is ApprovalRequest {
  return (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "item/permissions/requestApproval"
  );
}

export function approvalResponse(approval: PendingApproval, action: ApprovalAction): unknown {
  if (approval.method === "item/commandExecution/requestApproval") {
    return {
      decision: commandDecision(action),
    } satisfies CommandExecutionRequestApprovalResponse;
  }

  if (approval.method === "item/fileChange/requestApproval") {
    return {
      decision: fileChangeDecision(action),
    } satisfies FileChangeRequestApprovalResponse;
  }

  if (approval.method === "item/permissions/requestApproval") {
    return {
      scope: action === "accept-session" ? "session" : "turn",
      permissions: action === "accept" || action === "accept-session" ? grantedPermissions(approval.params.permissions) : {},
    } satisfies PermissionsRequestApprovalResponse;
  }

  throw new Error("Unsupported approval method.");
}

export function approvalTitle(approval: PendingApproval): string {
  if (approval.method.includes("commandExecution")) return "Command approval";
  if (approval.method.includes("fileChange")) return "File change approval";
  if (approval.method.includes("permissions")) return "Permission approval";
  return approval.method;
}

export function approvalSummary(approval: PendingApproval): string {
  const params = approval.params as Record<string, unknown>;
  if (approval.method.includes("commandExecution")) {
    return typeof params.command === "string" ? params.command : "Command execution requested.";
  }
  if (approval.method.includes("fileChange")) {
    return typeof params.grantRoot === "string"
      ? `grant root: ${params.grantRoot}`
      : typeof params.reason === "string"
        ? params.reason
        : "Allow file changes?";
  }
  if (approval.method.includes("permissions")) {
    return [
      `cwd: ${typeof params.cwd === "string" ? params.cwd : "(unknown)"}`,
      typeof params.reason === "string" ? params.reason : "",
      jsonPreview(params.permissions),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return jsonPreview(params);
}

export function approvalDetails(approval: PendingApproval): Array<{ key: string; value: string }> {
  const params = approval.params as Record<string, unknown>;
  const rows: Array<{ key: string; value: string }> = [
    { key: "method", value: approval.method },
    { key: "cwd", value: stringValue(params.cwd, "(unknown)") },
  ];
  addOptional(rows, "reason", params.reason);
  addOptional(rows, "grant root", params.grantRoot);
  addOptional(rows, "command", Array.isArray(params.command) ? params.command.join(" ") : params.command);
  addOptional(rows, "actions", params.commandActions);
  addOptional(rows, "permissions", params.permissions);
  addOptional(rows, "future command rule", params.proposedExecpolicyAmendment);
  addOptional(rows, "future network rules", params.proposedNetworkPolicyAmendments);
  if (Object.keys(params).length > 0) rows.push({ key: "raw", value: jsonPreview(params) });
  return rows;
}

function commandDecision(action: ApprovalAction): CommandExecutionRequestApprovalResponse["decision"] {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function fileChangeDecision(action: ApprovalAction): FileChangeRequestApprovalResponse["decision"] {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function grantedPermissions(requested: unknown): GrantedPermissionProfile {
  const source = requested as { network?: unknown; fileSystem?: unknown } | null;
  const granted: GrantedPermissionProfile = {};
  if (source?.network) granted.network = source.network as GrantedPermissionProfile["network"];
  if (source?.fileSystem) granted.fileSystem = source.fileSystem as GrantedPermissionProfile["fileSystem"];
  return granted;
}

function addOptional(rows: Array<{ key: string; value: string }>, key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  rows.push({ key, value: stringValue(value) });
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}
