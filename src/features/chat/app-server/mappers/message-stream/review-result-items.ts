import { pathRelativeToRoot } from "../../../../../shared/path/file-paths";
import {
  type ExecutionStateByStatus,
  executionStateFromStatus,
  RUNNING_EXECUTION_STATE,
} from "../../../domain/message-stream/execution-state";
import { permissionRows } from "../../../domain/message-stream/format/permission-rows";
import type { ExecutionState, MessageStreamAuditFact, MessageStreamItem } from "../../../domain/message-stream/items";

const AUTO_REVIEW_STATES: ExecutionStateByStatus = {
  inProgress: RUNNING_EXECUTION_STATE,
  approved: "completed",
  denied: "failed",
  timedOut: "failed",
  aborted: "failed",
};

type AutoReviewNotification = AutoReviewStartedNotification | AutoReviewCompletedNotification;

interface AutoReviewStartedNotification {
  threadId: string;
  turnId: string;
  startedAtMs: number;
  reviewId: string;
  targetItemId: string | null;
  review: AutoReview;
  action: AutoReviewAction;
}

interface AutoReviewCompletedNotification extends AutoReviewStartedNotification {
  completedAtMs: number;
  decisionSource: string;
}

interface AutoReview {
  status: string;
  riskLevel: string | null;
  userAuthorization: string | null;
  rationale: string | null;
}

type AutoReviewAction =
  | { type: "command"; source: string; command: string; cwd: string }
  | { type: "execve"; source: string; program: string; argv: readonly string[]; cwd: string }
  | { type: "applyPatch"; cwd: string; files: readonly string[] }
  | { type: "networkAccess"; target: string; host: string; protocol: string; port: number }
  | {
      type: "mcpToolCall";
      server: string;
      toolName: string;
      connectorId: string | null;
      connectorName: string | null;
      toolTitle: string | null;
    }
  | { type: "requestPermissions"; reason: string | null; permissions: Parameters<typeof permissionRows>[0] };

export function createReviewResultItem(id: string, text: string): MessageStreamItem {
  const parsed = parseAutomaticApprovalReviewMessage(text);
  if (parsed) {
    return {
      id,
      kind: "reviewResult",
      role: "tool",
      text: parsed.summary,
      provenance: { source: "panel", channel: "notice", reason: "parsedAutoReview", sourceId: id },
      executionState: autoReviewExecutionState(parsed.status),
      review: { auditFacts: parsed.rows },
    };
  }
  return {
    id,
    kind: "reviewResult",
    role: "tool",
    text,
    provenance: { source: "panel", channel: "notice", reason: "reviewMessage", sourceId: id },
  };
}

export function createAutoReviewResultItem(params: AutoReviewNotification): MessageStreamItem {
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
    provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: params.reviewId },
    executionState: completed ? autoReviewExecutionState(status) : RUNNING_EXECUTION_STATE,
    review: { auditFacts: rows },
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

function autoReviewActionRows(action: AutoReviewAction): MessageStreamAuditFact[] {
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
      {
        key: "files",
        value: action.files.length > 0 ? action.files.map((file) => pathRelativeToRoot(file, action.cwd)).join("\n") : "(none)",
      },
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

function autoReviewActionLabel(action: AutoReviewAction): string {
  if (action.type === "command") return action.command;
  if (action.type === "execve") return [action.program, ...action.argv].join(" ");
  if (action.type === "applyPatch") return `apply patch (${String(action.files.length)} files)`;
  if (action.type === "networkAccess") return `${action.protocol}://${action.host}:${String(action.port)}`;
  if (action.type === "mcpToolCall") return `${action.server}.${action.toolName}`;
  return action.reason ?? "permission request";
}

function autoReviewExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AUTO_REVIEW_STATES);
}
