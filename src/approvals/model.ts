import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import type { CommandExecutionApprovalDecision } from "../generated/app-server/v2/CommandExecutionApprovalDecision";
import type { CommandExecutionRequestApprovalResponse } from "../generated/app-server/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalResponse } from "../generated/app-server/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "../generated/app-server/v2/GrantedPermissionProfile";
import type { PermissionsRequestApprovalResponse } from "../generated/app-server/v2/PermissionsRequestApprovalResponse";
import { jsonPreview } from "../utils";
import { addOptional, nonEmptyString, permissionRows } from "./permission-details";

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | CommandApprovalDecisionAction;
export interface CommandApprovalDecisionAction {
  kind: "command-decision";
  decision: CommandExecutionApprovalDecision;
}
export interface ApprovalActionOption {
  label: string;
  action: ApprovalAction;
  className: string;
}
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

interface ApprovalSummaryParts {
  reason: string | null;
  target: string | null;
  fallback: string;
  lines: string[];
}

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
      decision: isCommandDecisionAction(action) ? action.decision : commandDecision(action),
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

export function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  if (approval.method !== "item/commandExecution/requestApproval") return defaultApprovalActionOptions();
  const decisions = approval.params.availableDecisions;
  if (!decisions || decisions.length === 0) return defaultApprovalActionOptions();
  return decisions.map((decision) => ({
    label: commandDecisionLabel(decision),
    action: { kind: "command-decision", decision },
    className: commandDecisionClassName(decision),
  }));
}

export function approvalSummary(approval: PendingApproval): string {
  return approvalSummaryParts(approval).lines.join("\n");
}

export function approvalResultSummary(approval: PendingApproval): string {
  const summary = approvalSummaryParts(approval);
  return summary.reason ?? summary.target ?? summary.fallback;
}

function approvalSummaryParts(approval: PendingApproval): ApprovalSummaryParts {
  const params = approval.params as Record<string, unknown>;
  const reason = nonEmptyString(params.reason);
  if (approval.method.includes("commandExecution")) {
    const target = nonEmptyString(params.command);
    return summaryParts(reason, target, "Command execution requested.");
  }
  if (approval.method.includes("fileChange")) {
    const grantRoot = nonEmptyString(params.grantRoot);
    return summaryParts(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?");
  }
  if (approval.method.includes("permissions")) {
    const cwd = `cwd: ${typeof params.cwd === "string" ? params.cwd : "(unknown)"}`;
    return summaryParts(reason, cwd, "Permission change requested.", jsonPreview(params.permissions));
  }
  const fallback = jsonPreview(params);
  return summaryParts(reason, null, fallback);
}

export function approvalDetails(approval: PendingApproval): { key: string; value: string }[] {
  const params = approval.params as Record<string, unknown>;
  const rows: { key: string; value: string }[] = [];
  addOptional(rows, "reason", params.reason);
  addOptional(rows, "command", Array.isArray(params.command) ? params.command.join(" ") : params.command);
  addOptional(rows, "cwd", params.cwd);
  addOptional(rows, "grant root", params.grantRoot);
  addOptional(rows, "actions", params.commandActions);
  rows.push(...permissionRows(params.permissions));
  addOptional(rows, "future command rule", params.proposedExecpolicyAmendment);
  addOptional(rows, "future network rules", params.proposedNetworkPolicyAmendments);
  return rows;
}

function summaryParts(reason: string | null, target: string | null, fallback: string, extra?: string | null): ApprovalSummaryParts {
  const lines = [reason, target, extra].filter((value): value is string => Boolean(value));
  return {
    reason,
    target,
    fallback,
    lines: lines.length > 0 ? lines : [fallback],
  };
}

function commandDecision(action: ApprovalAction): CommandExecutionRequestApprovalResponse["decision"] {
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

function defaultApprovalActionOptions(): ApprovalActionOption[] {
  return [
    { label: "Allow", action: "accept", className: "mod-cta" },
    { label: "Allow session", action: "accept-session", className: "" },
    { label: "Deny", action: "decline", className: "mod-warning" },
    { label: "Cancel", action: "cancel", className: "" },
  ];
}

function commandDecisionLabel(decision: CommandExecutionApprovalDecision): string {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow session";
  if (decision === "decline") return "Deny";
  if (decision === "cancel") return "Cancel";
  if ("acceptWithExecpolicyAmendment" in decision) return "Allow rule";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "Allow network rule" : "Deny network rule";
  }
  return "Choose";
}

function commandDecisionClassName(decision: CommandExecutionApprovalDecision): string {
  const kind = approvalActionKind({ kind: "command-decision", decision });
  if (kind === "accept") return "mod-cta";
  if (kind === "decline") return "mod-warning";
  return "";
}

function isCommandDecisionAction(action: ApprovalAction): action is CommandApprovalDecisionAction {
  return typeof action === "object";
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
