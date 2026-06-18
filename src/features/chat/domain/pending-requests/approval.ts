import { jsonPreview } from "../../../../utils";
import { pathRelativeToRoot } from "../message-stream/format/path-labels";
import { permissionRows, type MessageStreamPermissionProfile } from "../message-stream/format/permission-rows";
import type { PendingApproval } from "./model";

interface ApprovalSummaryParts {
  reason: string | null;
  target: string | null;
  fallback: string;
  lines: string[];
}

interface DetailRow {
  key: string;
  value: string;
}

interface CommandAction {
  type: string;
  command?: unknown;
  name?: unknown;
  path?: unknown;
  query?: unknown;
}

interface NetworkApprovalContext {
  host?: unknown;
  protocol?: unknown;
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

export function approvalDetails(approval: PendingApproval): DetailRow[] {
  const rows: DetailRow[] = [];
  addOptional(rows, "reason", approval.params.reason);
  switch (approval.method) {
    case "item/commandExecution/requestApproval":
      addOptional(rows, "command", approval.params.command);
      addOptional(rows, "cwd", approval.params.cwd);
      addOptional(rows, "network", networkApprovalContextLabel(approval.params.networkApprovalContext));
      rows.push(...commandActionRows(approval.params.commandActions, approval.params.cwd));
      rows.push(...prefixedPermissionRows("additional", approval.params.additionalPermissions));
      addOptional(rows, "future command rule", approval.params.proposedExecpolicyAmendment);
      addOptional(rows, "future network rules", networkPolicyAmendmentsLabel(approval.params.proposedNetworkPolicyAmendments));
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

function commandActionRows(value: unknown, cwd: string | null | undefined): DetailRow[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return [
    {
      key: value.length === 1 ? "action" : "actions",
      value: value
        .map((action) => (isCommandAction(action) ? commandActionLabel(action, cwd) : stringValue(action, "unknown action")))
        .join("\n"),
    },
  ];
}

function commandActionLabel(action: CommandAction, cwd: string | null | undefined): string {
  if (action.type === "read") {
    const path = pathLabel(action.path, cwd);
    return path ? `read ${path}` : `read ${nonEmptyString(action.name) ?? "file"}`;
  }
  if (action.type === "search") {
    const query = nonEmptyString(action.query);
    const path = pathLabel(action.path, cwd);
    if (query && path) return `search "${query}" in ${path}`;
    if (query) return `search "${query}"`;
    if (path) return `search ${path}`;
    return "search";
  }
  if (action.type === "listFiles") {
    return `list files ${pathLabel(action.path, cwd) ?? "workspace"}`;
  }
  return nonEmptyString(action.command) ?? action.type;
}

function isCommandAction(value: unknown): value is CommandAction {
  return value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function pathLabel(path: unknown, cwd: string | null | undefined): string | null {
  const value = nonEmptyString(path);
  return value ? pathRelativeToRoot(value, cwd) : null;
}

function networkApprovalContextLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const context = value as NetworkApprovalContext;
  const host = nonEmptyString(context.host);
  if (!host) return null;
  const protocol = nonEmptyString(context.protocol);
  return protocol ? `${protocol}://${host}` : host;
}

function prefixedPermissionRows(prefix: string, permissions: unknown): DetailRow[] {
  if (!permissions) return [];
  return permissionRows(permissions as MessageStreamPermissionProfile).map((row) => ({ ...row, key: `${prefix} ${row.key}` }));
}

function networkPolicyAmendmentsLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(networkPolicyAmendmentLabel).join("\n");
}

function networkPolicyAmendmentLabel(value: unknown): string {
  if (!value || typeof value !== "object") return stringValue(value, "rule");
  const amendment = value as { action?: unknown; host?: unknown };
  return `${nonEmptyString(amendment.action) ?? "rule"} ${nonEmptyString(amendment.host) ?? "(unknown host)"}`;
}

function addOptional(rows: DetailRow[], key: string, value: unknown): void {
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
