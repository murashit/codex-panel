import type { FileSystemPath } from "../generated/app-server/v2/FileSystemPath";
import type { GuardianApprovalReviewAction } from "../generated/app-server/v2/GuardianApprovalReviewAction";
import type { ItemGuardianApprovalReviewCompletedNotification } from "../generated/app-server/v2/ItemGuardianApprovalReviewCompletedNotification";
import type { ItemGuardianApprovalReviewStartedNotification } from "../generated/app-server/v2/ItemGuardianApprovalReviewStartedNotification";
import type { DisplayItem } from "./types";
import { classifyExecutionState } from "./state";

type AutoReviewNotification = ItemGuardianApprovalReviewStartedNotification | ItemGuardianApprovalReviewCompletedNotification;
type DisplayRow = { key: string; value: string };

export function createReviewResultItem(text: string): DisplayItem {
  const parsed = parseAutomaticApprovalReviewMessage(text);
  if (parsed) {
    return {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: "reviewResult",
      role: "tool",
      text: parsed.summary,
      markdown: false,
      state: classifyExecutionState({ status: parsed.status }),
      details: [{ title: "Review", rows: parsed.rows }],
    };
  }
  return {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
): { status: string; summary: string; rows: Array<{ key: string; value: string }> } | null {
  const match = /^Automatic approval review\s+([a-zA-Z][\w-]*)(?:\s+\(([^)]*)\))?:\s*(.+)$/i.exec(text.trim());
  if (!match) return null;

  const status = match[1]?.trim() ?? "review";
  const fieldText = match[2]?.trim();
  const message = match[3]?.trim() ?? "";
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
      { key: "files", value: action.files.length > 0 ? action.files.join("\n") : "(none)" },
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
  if (action.type === "requestPermissions") {
    return [
      { key: "action", value: "request permissions" },
      ...(action.reason ? [{ key: "reason", value: action.reason }] : []),
      ...permissionRows(action.permissions),
    ];
  }
  return [{ key: "action", value: "review action" }];
}

function permissionRows(permissions: Extract<GuardianApprovalReviewAction, { type: "requestPermissions" }>["permissions"]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  if (permissions.network?.enabled !== null && permissions.network?.enabled !== undefined) {
    rows.push({ key: "network", value: permissions.network.enabled ? "enabled" : "disabled" });
  }
  const fileSystem = permissions.fileSystem;
  if (!fileSystem) return rows;
  if (fileSystem.entries && fileSystem.entries.length > 0) {
    rows.push({
      key: "filesystem",
      value: fileSystem.entries.map((entry) => `${fileSystemPathLabel(entry.path)} (${entry.access})`).join("\n"),
    });
  }
  if (fileSystem.read && fileSystem.read.length > 0) rows.push({ key: "read", value: fileSystem.read.join("\n") });
  if (fileSystem.write && fileSystem.write.length > 0) rows.push({ key: "write", value: fileSystem.write.join("\n") });
  if (fileSystem.globScanMaxDepth !== null && fileSystem.globScanMaxDepth !== undefined) {
    rows.push({ key: "glob depth", value: String(fileSystem.globScanMaxDepth) });
  }
  return rows;
}

function fileSystemPathLabel(path: FileSystemPath): string {
  if (path.type === "path") return path.path;
  if (path.type === "glob_pattern") return path.pattern;
  if (path.value.kind === "project_roots") return path.value.subpath ? `project_roots/${path.value.subpath}` : "project_roots";
  if (path.value.kind === "unknown") return path.value.subpath ? `${path.value.path}/${path.value.subpath}` : path.value.path;
  return path.value.kind;
}

function autoReviewActionLabel(action: GuardianApprovalReviewAction): string {
  if (action.type === "command") return action.command;
  if (action.type === "execve") return [action.program, ...action.argv].join(" ");
  if (action.type === "applyPatch") return `apply patch (${action.files.length} files)`;
  if (action.type === "networkAccess") return `${action.protocol}://${action.host}:${action.port}`;
  if (action.type === "mcpToolCall") return `${action.server}.${action.toolName}`;
  if (action.type === "requestPermissions") return action.reason ?? "permission request";
  return "review action";
}
