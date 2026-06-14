import { jsonPreview, truncate } from "../../../../utils";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import type {
  ApprovalResultMessageStreamItem,
  CommandMessageStreamItem,
  CommandMessageStreamTarget,
  ExecutionState,
  FileChangeMessageStreamItem,
  GoalMessageStreamItem,
  HookMessageStreamItem,
  MessageStreamFileChange,
  MessageStreamItem,
  MessageStreamPrimaryTarget,
  ReviewResultMessageStreamItem,
  ToolCallMessageStreamItem,
} from "../../domain/message-stream/model/items";

export type ToolResultMessageStreamItem =
  | CommandMessageStreamItem
  | FileChangeMessageStreamItem
  | GoalMessageStreamItem
  | ToolCallMessageStreamItem
  | HookMessageStreamItem
  | ApprovalResultMessageStreamItem
  | ReviewResultMessageStreamItem;

export type ToolResultDetailSection =
  | { kind: "meta"; title?: string; rows: { key: string; value: string }[] }
  | { kind: "output"; title: string; body: string }
  | { kind: "diff"; title: string; diff: string };

export interface ToolResultView {
  className: string;
  label: string;
  summary: string;
  detailsKey: string;
  details: ToolResultDetailSection[];
  state: ExecutionState;
}

export function toolResultView(item: ToolResultMessageStreamItem, workspaceRoot?: string | null): ToolResultView {
  if (item.kind === "command") return commandToolView(item);
  if (item.kind === "fileChange") return fileChangeToolView(item, workspaceRoot);
  if (item.kind === "goal") return goalToolView(item);
  if (item.kind === "approvalResult") return approvalToolView(item);
  if (item.kind === "reviewResult") return reviewToolView(item);
  return genericToolView(item, workspaceRoot);
}

function commandToolView(item: CommandMessageStreamItem): ToolResultView {
  const rows = [
    { key: "command", value: item.command },
    { key: "cwd", value: item.cwd },
    { key: "status", value: item.status },
    ...(item.exitCode !== undefined ? [{ key: "exit", value: String(item.exitCode) }] : []),
    ...(item.durationMs !== undefined ? [{ key: "duration", value: `${String(item.durationMs)}ms` }] : []),
  ];
  const details: ToolResultDetailSection[] = [
    {
      kind: "meta",
      rows,
    },
    ...outputSection("Output", item.output),
  ];
  return toolView(
    item,
    "codex-panel__tool-item",
    commandActionLabel(item.commandAction),
    `${item.id}:command-details`,
    details,
    commandSummary(item),
  );
}

function fileChangeToolView(item: FileChangeMessageStreamItem, workspaceRoot?: string | null): ToolResultView {
  const displayChanges = item.changes.map((change) => ({
    ...change,
    displayPath: change.path && change.path !== "(unknown)" ? pathRelativeToRoot(change.path, workspaceRoot) : change.path,
  }));
  const details: ToolResultDetailSection[] = [
    {
      kind: "meta",
      rows: [
        { key: "status", value: item.status },
        { key: "files", value: String(item.changes.length) },
      ],
    },
    ...displayChanges.map((change) => ({
      kind: "diff" as const,
      title: `${change.kind} ${change.displayPath}`,
      diff: change.diff,
    })),
    ...outputSection("Patch output", item.output),
  ];
  return toolView(
    item,
    "codex-panel__file-change",
    "file change",
    `${item.id}:file-change-details`,
    details,
    fileChangeSummary(item, displayChanges),
  );
}

function goalToolView(item: GoalMessageStreamItem): ToolResultView {
  return toolView(item, "codex-panel__tool-item codex-panel__tool-item--goal", "goal", `${item.id}:goal-details`, goalDetails(item));
}

function genericToolView(item: ToolCallMessageStreamItem | HookMessageStreamItem, workspaceRoot?: string | null): ToolResultView {
  return toolView(
    item,
    `codex-panel__tool-item codex-panel__tool-item--${item.kind}`,
    item.toolName ?? item.kind,
    `${item.id}:details`,
    [...genericToolDetails(item), ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output)],
    genericToolSummary(item, workspaceRoot),
  );
}

function reviewToolView(item: ReviewResultMessageStreamItem): ToolResultView {
  return resultToolView(
    item,
    "auto-review",
    `${item.id}:review-details`,
    "codex-panel__message--review-result codex-panel__tool-item--review",
  );
}

function approvalToolView(item: ApprovalResultMessageStreamItem): ToolResultView {
  return resultToolView(
    item,
    "approval",
    `${item.id}:approval-details`,
    "codex-panel__message--approval-result codex-panel__tool-item--approval",
  );
}

function resultToolView(
  item: ApprovalResultMessageStreamItem | ReviewResultMessageStreamItem,
  label: string,
  detailsKey: string,
  className: string,
): ToolResultView {
  return toolView(item, `codex-panel__tool-item ${className}`, label, detailsKey, resultDetails(item));
}

function toolView(
  item: ToolResultMessageStreamItem,
  className: string,
  label: string,
  detailsKey: string,
  details: ToolResultDetailSection[],
  summary = fallbackSummary(item),
): ToolResultView {
  return {
    className: `codex-panel__message codex-panel__message--tool ${className}`,
    label,
    summary,
    detailsKey,
    details,
    state: item.executionState ?? null,
  };
}

function outputSection(title: string, body: string | null | undefined): ToolResultDetailSection[] {
  return body ? [{ kind: "output", title, body }] : [];
}

function goalDetails(item: GoalMessageStreamItem): ToolResultDetailSection[] {
  return [
    {
      kind: "meta",
      rows: [{ key: "action", value: item.action }],
    },
    ...outputSection("Objective", item.objective),
  ];
}

function resultDetails(item: ApprovalResultMessageStreamItem | ReviewResultMessageStreamItem): ToolResultDetailSection[] {
  if (item.kind === "approvalResult") {
    return [
      {
        kind: "meta",
        rows: [
          { key: "status", value: item.approval.status },
          { key: "scope", value: item.approval.scope },
          { key: "request", value: item.approval.request },
          ...item.approval.auditFacts,
        ],
      },
    ];
  }
  return item.review?.auditFacts && item.review.auditFacts.length > 0 ? [{ kind: "meta", rows: item.review.auditFacts }] : [];
}

function genericToolDetails(item: ToolCallMessageStreamItem | HookMessageStreamItem): ToolResultDetailSection[] {
  if (item.kind === "hook") return hookRunDetails(item);
  return [...toolCallDetails(item), ...webSearchDetails(item), ...imageGenerationDetails(item)];
}

function toolCallDetails(item: ToolCallMessageStreamItem): ToolResultDetailSection[] {
  const details = item.toolCall;
  if (!details) return [];
  return [
    ...jsonOutputSection("Arguments JSON", details.arguments),
    ...jsonOutputSection("Result JSON", details.result),
    ...jsonOutputSection("Error JSON", details.error),
  ];
}

function webSearchDetails(item: ToolCallMessageStreamItem): ToolResultDetailSection[] {
  const details = item.webSearch;
  if (!details) return [];
  const rows = [
    ...metaRow("action", details.action),
    ...metaRow("query", details.query),
    ...metaRow("pattern", details.pattern),
    ...metaRow("url", details.url),
  ];
  return rows.length > 0 ? [{ kind: "meta", title: "web search", rows }] : [];
}

function imageGenerationDetails(item: ToolCallMessageStreamItem): ToolResultDetailSection[] {
  const details = item.imageGeneration;
  if (!details) return [];
  return [
    ...outputSection("Saved path", details.savedPath),
    ...outputSection("Revised prompt", details.revisedPrompt),
    ...outputSection("Result", details.result),
  ];
}

function hookRunDetails(item: HookMessageStreamItem): ToolResultDetailSection[] {
  const details = item.hookRun;
  if (!details) return [];
  const rows = [
    ...metaRow("status", item.status),
    { key: "event", value: details.eventName },
    ...metaRow("message", details.statusMessage),
    ...metaRow("duration", details.durationMs),
  ];
  const entries = details.entries.map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  return [{ kind: "meta", rows }, ...outputSection("Hook output", entries)];
}

function jsonOutputSection(title: string, value: unknown): ToolResultDetailSection[] {
  return value === null || value === undefined ? [] : outputSection(title, jsonPreview(value));
}

function metaRow(key: string, value: string | null | undefined): { key: string; value: string }[] {
  return value ? [{ key, value }] : [];
}

function commandActionLabel(action: CommandMessageStreamItem["commandAction"]): string {
  if (action === "read") return "read";
  if (action === "search") return "search";
  if (action === "listFiles") return "list files";
  return "command";
}

function commandSummary(item: CommandMessageStreamItem): string {
  return compactSummary(null, commandTargetSummary(item.commandTarget, item.cwd), commandQualifier(item));
}

function commandTargetSummary(target: CommandMessageStreamTarget, cwd: string): string {
  if (target.kind === "read") return target.path ? pathRelativeToRoot(target.path, cwd) : target.name;
  if (target.kind === "search") {
    const query = target.query ? quoteInline(target.query) : null;
    const path = target.path ? pathRelativeToRoot(target.path, cwd) : null;
    if (query && path) return `${query} in ${path}`;
    if (query) return query;
    if (path) return path;
    return "search";
  }
  if (target.kind === "listFiles") return target.path ? pathRelativeToRoot(target.path, cwd) : "workspace";
  return target.commandLine;
}

function commandQualifier(item: CommandMessageStreamItem): string | null {
  if (typeof item.exitCode === "number" && item.exitCode !== 0) return `exit ${String(item.exitCode)}`;
  return statusQualifier(item.status, failedStatusLabel(item.status));
}

function genericToolSummary(item: ToolCallMessageStreamItem | HookMessageStreamItem, workspaceRoot?: string | null): string {
  const target = primaryTargetSummary(item.primaryTarget, workspaceRoot);
  if (!target) return item.text ?? "details";
  return compactSummary(toolOperationLabel(item.operation), target, statusQualifier(item.status, item.failureReason));
}

function fileChangeSummary(item: MessageStreamItem, changes: (MessageStreamFileChange & { displayPath: string })[]): string {
  if (item.kind !== "fileChange") return "text" in item && typeof item.text === "string" ? item.text : "details";
  const target = fileChangeTargetSummary(changes);
  return compactSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status)));
}

function fallbackSummary(item: ToolResultMessageStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "details";
}

function fileChangeTargetSummary(changes: (MessageStreamFileChange & { displayPath: string })[]): string {
  if (changes.length === 0) return "no files";
  if (changes.length === 1) return changes[0]?.displayPath ?? "1 file";
  return `${String(changes.length)} files`;
}

function primaryTargetSummary(target: MessageStreamPrimaryTarget | undefined, workspaceRoot?: string | null): string | null {
  if (!target) return null;
  if (target.kind === "path") return pathRelativeToRoot(target.path, workspaceRoot);
  return target.value;
}

function compactSummary(label: string | null, target?: string | null, qualifier?: string | null): string {
  const targetText = target?.trim();
  const base = label ? (targetText ? `${label}: ${targetText}` : label) : (targetText ?? "details");
  return truncate(qualifier ? `${base} (${qualifier})` : base, 140);
}

function statusQualifier(status: unknown, failure?: string | null): string | null {
  if (status === "declined") return "declined";
  if (status === "failed") return failure && failure.length > 0 ? failure : "failed";
  return null;
}

function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function toolOperationLabel(operation: string | null | undefined): string | null {
  if (!operation) return null;
  if (operation === "openPage") return "open page";
  if (operation === "findInPage") return "find in page";
  if (operation === "search") return "search";
  if (operation === "webSearch") return "web search";
  if (operation === "other") return "other";
  return operation;
}

function quoteInline(value: string): string {
  return value.includes(" ") ? JSON.stringify(value) : value;
}
