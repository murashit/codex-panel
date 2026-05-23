import { permissionRows } from "../approvals/permission-details";
import type { GuardianApprovalReviewAction } from "../../../generated/app-server/v2/GuardianApprovalReviewAction";
import type { ItemGuardianApprovalReviewCompletedNotification } from "../../../generated/app-server/v2/ItemGuardianApprovalReviewCompletedNotification";
import type { ItemGuardianApprovalReviewStartedNotification } from "../../../generated/app-server/v2/ItemGuardianApprovalReviewStartedNotification";
import type { DisplayItem } from "./types";
import { pathsRelativeToRoot } from "./paths";
import { classifyExecutionState } from "./state";

type AutoReviewNotification = ItemGuardianApprovalReviewStartedNotification | ItemGuardianApprovalReviewCompletedNotification;
interface DisplayRow {
  key: string;
  value: string;
}

export function createReviewResultItem(text: string): DisplayItem {
  const parsed = parseAutomaticApprovalReviewMessage(text);
  if (parsed) {
    return {
      id: `review-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
      kind: "reviewResult",
      role: "tool",
      text: parsed.summary,
      markdown: false,
      state: classifyExecutionState({ status: parsed.status }),
      details: [{ title: "Review", rows: parsed.rows }],
    };
  }
  return {
    id: `review-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    kind: "reviewResult",
    role: "tool",
    text,
    markdown: false,
  };
}

export function createAutoReviewResultItem(params: AutoReviewNotification): DisplayItem {
  const completed = "decisionSource" in params;
  const status = params.review.status;
  const action = autoReviewActionLabel(params.action);
  const text = completed ? `Auto-review ${status}: ${action}` : `Auto-review started: ${action}`;
  const rows = [
    { key: "status", value: status },
    ...("decisionSource" in params ? [{ key: "source", value: params.decisionSource }] : []),
    ...(params.review.riskLevel ? [{ key: "risk", value: params.review.riskLevel }] : []),
    ...(params.review.userAuthorization ? [{ key: "authorization", value: params.review.userAuthorization }] : []),
    ...autoReviewActionRows(params.action),
    ...(params.targetItemId ? [{ key: "target", value: params.targetItemId }] : []),
    ...(params.review.rationale ? [{ key: "rationale", value: params.review.rationale }] : []),
  ];
  return {
    id: `review-${params.reviewId}`,
    kind: "reviewResult",
    role: "tool",
    text,
    turnId: params.turnId,
    markdown: false,
    state: completed ? classifyExecutionState({ status }) : "running",
    details: [{ title: "Review", rows }],
  };
}

function parseAutomaticApprovalReviewMessage(
  text: string,
): { status: string; summary: string; rows: { key: string; value: string }[] } | null {
  const match = /^Automatic approval review\s+([a-zA-Z][\w-]*)(?:\s+\(([^)]*)\))?:\s*(.+)$/i.exec(text.trim());
  if (!match) return null;

  const statusText = match[1];
  const messageText = match[3];
  if (statusText === undefined || messageText === undefined) return null;
  const status = statusText.trim();
  const fieldText = match.at(2)?.trim();
  const message = messageText.trim();
  const rows = [{ key: "status", value: status }];
  for (const field of fieldText?.split(",") ?? []) {
    const fieldMatch = /^\s*([^:]+):\s*(.+?)\s*$/.exec(field);
    if (fieldMatch?.[1] && fieldMatch[2]) rows.push({ key: fieldMatch[1].trim(), value: fieldMatch[2].trim() });
  }
  if (message) rows.push({ key: "message", value: message });

  return {
    status,
    summary: message ? `Auto-review ${status}: ${message}` : `Auto-review ${status}`,
    rows,
  };
}

function autoReviewActionRows(action: GuardianApprovalReviewAction): DisplayRow[] {
  if (action.type === "command") {
    return [
      { key: "action", value: "command" },
      { key: "command", value: action.command },
      { key: "cwd", value: action.cwd },
      { key: "action source", value: action.source },
    ];
  }
  if (action.type === "execve") {
    return [
      { key: "action", value: "execve" },
      { key: "program", value: action.program },
      { key: "argv", value: action.argv.join(" ") },
      { key: "cwd", value: action.cwd },
      { key: "action source", value: action.source },
    ];
  }
  if (action.type === "applyPatch") {
    return [
      { key: "action", value: "apply patch" },
      { key: "cwd", value: action.cwd },
      { key: "files", value: action.files.length > 0 ? pathsRelativeToRoot(action.files, action.cwd).join("\n") : "(none)" },
    ];
  }
  if (action.type === "networkAccess") {
    return [
      { key: "action", value: "network access" },
      { key: "target", value: action.target },
      { key: "protocol", value: action.protocol },
      { key: "host", value: action.host },
      { key: "port", value: String(action.port) },
    ];
  }
  if (action.type === "mcpToolCall") {
    return [
      { key: "action", value: "MCP tool call" },
      { key: "server", value: action.server },
      { key: "tool", value: action.toolName },
      ...(action.toolTitle ? [{ key: "title", value: action.toolTitle }] : []),
      ...(action.connectorName ? [{ key: "connector", value: action.connectorName }] : []),
      ...(action.connectorId ? [{ key: "connector id", value: action.connectorId }] : []),
    ];
  }
  return [
    { key: "action", value: "request permissions" },
    ...(action.reason ? [{ key: "reason", value: action.reason }] : []),
    ...permissionRows(action.permissions),
  ];
}

function autoReviewActionLabel(action: GuardianApprovalReviewAction): string {
  if (action.type === "command") return action.command;
  if (action.type === "execve") return [action.program, ...action.argv].join(" ");
  if (action.type === "applyPatch") return `apply patch (${String(action.files.length)} files)`;
  if (action.type === "networkAccess") return `${action.protocol}://${action.host}:${String(action.port)}`;
  if (action.type === "mcpToolCall") return `${action.server}.${action.toolName}`;
  return action.reason ?? "permission request";
}
