import { pathRelativeToRoot } from "../../../../../domain/files/paths";
import type { ExecutionState, ReviewResultThreadStreamItem, ThreadStreamAuditFact } from "../../../domain/thread-stream/items";
import { type ExecutionStateByStatus, executionStateFromStatus, RUNNING_EXECUTION_STATE } from "./execution-state";
import { type AutoReviewPermissionProfile, permissionRows } from "./permission-rows";

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
  | { type: "writeStdin"; approvalId: string; processId: string; stdin: string; cwd: string }
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
  | { type: "requestPermissions"; reason: string | null; permissions: AutoReviewPermissionProfile };

export function createReviewResultItem(id: string, text: string): ReviewResultThreadStreamItem {
  const parsed = parseAutomaticApprovalReviewMessage(text);
  if (parsed) {
    return {
      id,
      kind: "reviewResult",
      role: "tool",
      text: parsed.summary,
      reviewKind: "message",
      provenance: { source: "panel", channel: "notice", reason: "parsedAutoReview", sourceId: id },
      executionState: autoReviewExecutionState(parsed.status),
      review: { auditFacts: parsed.rows, originalMessage: text },
    };
  }
  return {
    id,
    kind: "reviewResult",
    role: "tool",
    text,
    reviewKind: "message",
    provenance: { source: "panel", channel: "notice", reason: "reviewMessage", sourceId: id },
    review: { auditFacts: [], originalMessage: text },
  };
}

export function createAutoReviewResultItem(params: AutoReviewNotification): ReviewResultThreadStreamItem {
  const completed = "decisionSource" in params;
  const status = params.review.status;
  const action = autoReviewActionLabel(params.action);
  const text = completed ? `Auto-review ${status}: ${action}` : `Auto-review started: ${action}`;
  const assessmentMessage = completed ? autoReviewAssessmentMessage(params.review) : null;
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
    reviewKind: "automaticResult",
    turnId: params.turnId,
    provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: params.reviewId },
    executionState: completed ? autoReviewExecutionState(status) : RUNNING_EXECUTION_STATE,
    review: { auditFacts: rows, ...(assessmentMessage === null ? {} : { assessmentMessage }) },
  };
}

function parseAutomaticApprovalReviewMessage(
  text: string,
): { status: string; summary: string; rows: { key: string; value: string }[] } | null {
  const match =
    /^Automatic approval review (approved|denied) \(risk: (low|medium|high|critical), authorization: (unknown|low|medium|high)\): ([\s\S]*)$/.exec(
      text,
    );
  if (!match) return null;
  const [, status, risk, authorization, message] = match;
  if (status === undefined || risk === undefined || authorization === undefined || message === undefined) return null;
  return {
    status,
    summary: message ? `Auto-review ${status}: ${message}` : `Auto-review ${status}`,
    rows: [
      { key: "status", value: status },
      { key: "risk", value: risk },
      { key: "authorization", value: authorization },
      { key: "message", value: message },
    ],
  };
}

function autoReviewAssessmentMessage(review: AutoReview): string | null {
  if (
    (review.status !== "approved" && review.status !== "denied") ||
    review.riskLevel === null ||
    !["low", "medium", "high", "critical"].includes(review.riskLevel) ||
    review.userAuthorization === null ||
    !["unknown", "low", "medium", "high"].includes(review.userAuthorization) ||
    review.rationale === null
  )
    return null;
  // The completed assessment and warning share this exact upstream template, not an event identity.
  return `Automatic approval review ${review.status} (risk: ${review.riskLevel}, authorization: ${review.userAuthorization}): ${review.rationale}`;
}

function autoReviewActionRows(action: AutoReviewAction): ThreadStreamAuditFact[] {
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
  if (action.type === "writeStdin") {
    return [
      { key: "action", value: "terminal input" },
      { key: "process", value: action.processId },
      { key: "input", value: action.stdin },
      { key: "cwd", value: action.cwd },
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
  if (action.type === "writeStdin") return `write stdin to ${action.processId}`;
  if (action.type === "applyPatch") return `apply patch (${String(action.files.length)} files)`;
  if (action.type === "networkAccess") return `${action.protocol}://${action.host}:${String(action.port)}`;
  if (action.type === "mcpToolCall") return `${action.server}.${action.toolName}`;
  return action.reason ?? "permission request";
}

function autoReviewExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AUTO_REVIEW_STATES);
}
