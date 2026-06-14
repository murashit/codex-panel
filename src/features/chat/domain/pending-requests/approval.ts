import { jsonPreview } from "../../../../utils";
import { permissionRows, type MessageStreamPermissionProfile } from "../message-stream/format/permission-rows";
import type { PendingApproval } from "./model";

interface ApprovalSummaryParts {
  reason: string | null;
  target: string | null;
  fallback: string;
  lines: string[];
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

export function approvalSummary(approval: PendingApproval): string {
  return approvalSummaryParts(approval).lines.join("\n");
}

export function approvalResultSummary(approval: PendingApproval): string {
  const summary = approvalSummaryParts(approval);
  return summary.reason ?? summary.target ?? summary.fallback;
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
      rows.push(...permissionRows(approval.params.permissions as MessageStreamPermissionProfile));
      break;
  }
  return rows;
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

function summaryParts(reason: string | null, target: string | null, fallback: string, extra?: string | null): ApprovalSummaryParts {
  const lines = [reason, target, extra].filter((value): value is string => Boolean(value));
  return {
    reason,
    target,
    fallback,
    lines: lines.length > 0 ? lines : [fallback],
  };
}

function addOptional(rows: { key: string; value: string }[], key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  rows.push({ key, value: stringValue(value) });
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
    return value.join("\n");
  }
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
