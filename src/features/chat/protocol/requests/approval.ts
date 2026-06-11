import type { RequestId } from "../../../../generated/app-server/RequestId";
import type { ServerRequest } from "../../../../generated/app-server/ServerRequest";
import type { CommandExecutionApprovalDecision } from "../../../../generated/app-server/v2/CommandExecutionApprovalDecision";
import type { CommandExecutionRequestApprovalResponse } from "../../../../generated/app-server/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalResponse } from "../../../../generated/app-server/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "../../../../generated/app-server/v2/GrantedPermissionProfile";
import type { PermissionsRequestApprovalResponse } from "../../../../generated/app-server/v2/PermissionsRequestApprovalResponse";
import { addOptional, nonEmptyString, permissionRows } from "../../display/permission-details";

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | CommandApprovalDecisionAction;
interface CommandApprovalDecisionAction {
  kind: "command-decision";
  decision: CommandExecutionApprovalDecision;
}
export interface ApprovalActionOption {
  label: string;
  action: ApprovalAction;
  className: string;
}
type ApprovalRequest = Extract<
  ServerRequest,
  {
    method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval";
  }
>;
export type ApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse;

type PendingApprovalFor<Request extends ApprovalRequest> = Request extends ApprovalRequest
  ? {
      requestId: RequestId;
      method: Request["method"];
      params: Request["params"];
    }
  : never;
export type PendingApproval = PendingApprovalFor<ApprovalRequest>;
type CommandApprovalRequest = Extract<ApprovalRequest, { method: "item/commandExecution/requestApproval" }>;
type FileChangeApprovalRequest = Extract<ApprovalRequest, { method: "item/fileChange/requestApproval" }>;
type PermissionsApprovalRequest = Extract<ApprovalRequest, { method: "item/permissions/requestApproval" }>;

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
      return pendingApproval(request);
    case "item/fileChange/requestApproval":
      return pendingApproval(request);
    case "item/permissions/requestApproval":
      return pendingApproval(request);
  }
}

function isApprovalRequest(request: ServerRequest): request is ApprovalRequest {
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
    } satisfies CommandExecutionRequestApprovalResponse;
  }

  if (approval.method === "item/fileChange/requestApproval") {
    return {
      decision: fileChangeDecision(action),
    } satisfies FileChangeRequestApprovalResponse;
  }

  return {
    scope: action === "accept-session" ? "session" : "turn",
    permissions: action === "accept" || action === "accept-session" ? grantedPermissions(approval.params.permissions) : {},
  } satisfies PermissionsRequestApprovalResponse;
}

export function approvalTitle(approval: PendingApproval): string {
  switch (approval.method) {
    case "item/commandExecution/requestApproval":
      return "Command approval";
    case "item/fileChange/requestApproval":
      return "File change approval";
    case "item/permissions/requestApproval":
      return "Permission approval";
  }
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
  switch (approval.method) {
    case "item/commandExecution/requestApproval": {
      const reason = nonEmptyString(approval.params.reason);
      const target = nonEmptyString(approval.params.command);
      return summaryParts(reason, target, "Command execution requested.");
    }
    case "item/fileChange/requestApproval": {
      const reason = nonEmptyString(approval.params.reason);
      const grantRoot = nonEmptyString(approval.params.grantRoot);
      return summaryParts(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?");
    }
    case "item/permissions/requestApproval": {
      return summaryParts(approval.params.reason, `cwd: ${approval.params.cwd}`, "Permission change requested.");
    }
  }
}

export function approvalDetails(approval: PendingApproval): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  addOptional(rows, "reason", approval.params.reason);
  switch (approval.method) {
    case "item/commandExecution/requestApproval":
      addOptional(rows, "command", approval.params.command);
      addOptional(rows, "cwd", approval.params.cwd);
      addOptional(rows, "actions", approval.params.commandActions);
      addOptional(rows, "future command rule", approval.params.proposedExecpolicyAmendment);
      addOptional(rows, "future network rules", approval.params.proposedNetworkPolicyAmendments);
      break;
    case "item/fileChange/requestApproval":
      addOptional(rows, "grant root", approval.params.grantRoot);
      break;
    case "item/permissions/requestApproval":
      addOptional(rows, "cwd", approval.params.cwd);
      addOptional(rows, "environment", approval.params.environmentId);
      rows.push(...permissionRows(approval.params.permissions));
      break;
  }
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

function grantedPermissions(
  requested: Extract<PendingApproval, { method: "item/permissions/requestApproval" }>["params"]["permissions"],
): GrantedPermissionProfile {
  const granted: GrantedPermissionProfile = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}
