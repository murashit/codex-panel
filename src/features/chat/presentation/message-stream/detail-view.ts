import { jsonPreview, shortThreadId, truncate } from "../../../../utils";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import type {
  AgentMessageStreamItem,
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
} from "../../domain/message-stream/items";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;
const AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT = 96;

export type DetailSection =
  | { kind: "kv"; title?: string; rows: readonly { readonly key: string; readonly value: string }[] }
  | { kind: "output"; title: string; body: string }
  | { kind: "diff"; title: string; diff: string };

export interface DetailView {
  className: string;
  label: string;
  summary: string;
  detailsKey: string;
  sections: DetailSection[];
  state: ExecutionState;
}

export function detailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView {
  return codexDetailView(item, workspaceRoot) ?? genericDetailView(item, workspaceRoot);
}

function codexDetailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView | null {
  switch (item.kind) {
    case "command":
      return commandDetailView(item);
    case "fileChange":
      return fileChangeDetailView(item, workspaceRoot);
    case "goal":
      return goalDetailView(item);
    case "approvalResult":
      return approvalDetailView(item);
    case "reviewResult":
      return reviewDetailView(item);
    case "agent":
      return agentDetailView(item);
    case "tool":
    case "hook":
      return genericToolDetailView(item, workspaceRoot);
    default:
      return null;
  }
}

function detailViewBase(
  item: MessageStreamItem,
  className: string,
  label: string,
  detailsKey: string,
  sections: DetailSection[],
  summary = fallbackSummary(item),
): DetailView {
  return {
    className: `codex-panel__message codex-panel__message--tool ${className}`,
    label,
    summary,
    detailsKey,
    sections,
    state: item.executionState ?? null,
  };
}

function commandDetailView(item: CommandMessageStreamItem): DetailView {
  const rows = [
    { key: "command", value: item.command },
    { key: "cwd", value: item.cwd },
    { key: "status", value: item.status },
    ...(item.exitCode !== undefined ? [{ key: "exit", value: String(item.exitCode) }] : []),
    ...(item.durationMs !== undefined ? [{ key: "duration", value: `${String(item.durationMs)}ms` }] : []),
  ];
  const sections: DetailSection[] = [
    {
      kind: "kv",
      rows,
    },
    ...outputSection("Output", item.output),
  ];
  return detailViewBase(
    item,
    "codex-panel__detail-item",
    commandActionLabel(item.commandAction),
    `${item.id}:command-details`,
    sections,
    commandSummary(item),
  );
}

function fileChangeDetailView(item: FileChangeMessageStreamItem, workspaceRoot?: string | null): DetailView {
  const displayChanges = item.changes.map((change) => ({
    ...change,
    displayPath: change.path && change.path !== "(unknown)" ? pathRelativeToRoot(change.path, workspaceRoot) : change.path,
  }));
  const sections: DetailSection[] = [
    {
      kind: "kv",
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
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__detail-item--file-change",
    "file change",
    `${item.id}:file-change-details`,
    sections,
    fileChangeSummary(item, displayChanges),
  );
}

function goalDetailView(item: GoalMessageStreamItem): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__detail-item--goal",
    "goal",
    messageDetailKey(item.id, "goal-details"),
    goalDetails(item),
  );
}

function agentDetailView(item: AgentMessageStreamItem): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__agent-activity",
    "agent",
    messageDetailKey(item.id, "agent-details"),
    agentDetailSections(item),
    agentSummaryText(item),
  );
}

function genericToolDetailView(item: ToolCallMessageStreamItem | HookMessageStreamItem, workspaceRoot?: string | null): DetailView {
  return detailViewBase(
    item,
    `codex-panel__detail-item codex-panel__detail-item--${item.kind}`,
    item.toolName ?? item.kind,
    messageDetailKey(item.id, "details"),
    [...genericToolDetails(item), ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output)],
    genericToolSummary(item, workspaceRoot),
  );
}

function reviewDetailView(item: ReviewResultMessageStreamItem): DetailView {
  return resultDetailView(
    item,
    "auto-review",
    messageDetailKey(item.id, "review-details"),
    "codex-panel__message--review-result codex-panel__detail-item--review",
  );
}

function approvalDetailView(item: ApprovalResultMessageStreamItem): DetailView {
  return resultDetailView(
    item,
    "approval",
    messageDetailKey(item.id, "approval-details"),
    "codex-panel__message--approval-result codex-panel__detail-item--approval",
  );
}

function genericDetailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView {
  return detailViewBase(
    item,
    `codex-panel__detail-item codex-panel__detail-item--${item.kind}`,
    detailLabel(item),
    messageDetailKey(item.id, "details"),
    genericDetailSections(item, workspaceRoot),
    genericDetailSummary(item, workspaceRoot),
  );
}

function messageDetailKey(itemId: string, suffix: string): string {
  return `${itemId}:${suffix}`;
}

function resultDetailView(
  item: ApprovalResultMessageStreamItem | ReviewResultMessageStreamItem,
  label: string,
  detailsKey: string,
  className: string,
): DetailView {
  return detailViewBase(item, `codex-panel__detail-item ${className}`, label, detailsKey, resultDetails(item));
}

function goalDetails(item: GoalMessageStreamItem): DetailSection[] {
  return [
    {
      kind: "kv",
      rows: [{ key: "action", value: item.action }],
    },
    ...outputSection("Objective", item.objective),
  ];
}

function agentDetailSections(item: AgentMessageStreamItem): DetailSection[] {
  const rows = [
    { key: "tool", value: agentActivityMetaLabel(item.tool) },
    { key: "status", value: item.status },
    { key: "sender", value: item.senderThreadId },
    ...(item.receiverThreadIds.length > 0 ? [{ key: "target", value: item.receiverThreadIds.join(", ") }] : []),
    ...(item.model ? [{ key: "model", value: item.model }] : []),
    ...(item.reasoningEffort ? [{ key: "effort", value: item.reasoningEffort }] : []),
  ];
  return [
    { kind: "kv", rows },
    ...outputSection("Prompt", item.prompt),
    ...agentStateSection(item),
    ...item.agents.flatMap((agent) =>
      agent.message && isLongAgentMessage(agent.message)
        ? outputSection(`Agent output ${shortThreadId(agent.threadId)}`, agent.message)
        : [],
    ),
  ];
}

function agentStateSection(item: AgentMessageStreamItem): DetailSection[] {
  const rows = item.agents.map((agent) => ({
    key: shortThreadId(agent.threadId),
    value: agentStatusLabel(agent.status, agent.message),
  }));
  return rows.length > 0 ? [{ kind: "kv", title: "agents", rows }] : [];
}

function resultDetails(item: ApprovalResultMessageStreamItem | ReviewResultMessageStreamItem): DetailSection[] {
  if (item.kind === "approvalResult") {
    return [
      {
        kind: "kv",
        rows: [
          { key: "status", value: item.approval.status },
          { key: "scope", value: item.approval.scope },
          { key: "request", value: item.approval.request },
          ...item.approval.auditFacts,
        ],
      },
    ];
  }
  return item.review?.auditFacts && item.review.auditFacts.length > 0 ? [{ kind: "kv", rows: item.review.auditFacts }] : [];
}

function genericToolDetails(item: ToolCallMessageStreamItem | HookMessageStreamItem): DetailSection[] {
  if (item.kind === "hook") return hookRunDetails(item);
  return [...toolCallDetails(item), ...webSearchDetails(item), ...imageGenerationDetails(item)];
}

function genericDetailSections(item: MessageStreamItem, workspaceRoot?: string | null): DetailSection[] {
  const rows = [
    ...metaRow("kind", item.kind),
    ...metaRow("status", stringField(item, "status")),
    ...metaRow("operation", stringField(item, "operation")),
    ...metaRow("target", primaryTargetSummary(primaryTargetField(item), workspaceRoot)),
    ...metaRow("failure", stringField(item, "failureReason")),
  ];
  return [...(rows.length > 0 ? [{ kind: "kv" as const, rows }] : []), ...outputSection("Output", outputField(item))];
}

function toolCallDetails(item: ToolCallMessageStreamItem): DetailSection[] {
  const details = item.toolCall;
  if (!details) return [];
  return [
    ...jsonOutputSection("Arguments JSON", details.arguments),
    ...jsonOutputSection("Result JSON", details.result),
    ...jsonOutputSection("Error JSON", details.error),
  ];
}

function webSearchDetails(item: ToolCallMessageStreamItem): DetailSection[] {
  const details = item.webSearch;
  if (!details) return [];
  const rows = [
    ...metaRow("action", details.action),
    ...metaRow("query", details.query),
    ...metaRow("pattern", details.pattern),
    ...metaRow("url", details.url),
  ];
  return rows.length > 0 ? [{ kind: "kv", title: "web search", rows }] : [];
}

function imageGenerationDetails(item: ToolCallMessageStreamItem): DetailSection[] {
  const details = item.imageGeneration;
  if (!details) return [];
  return [
    ...outputSection("Saved path", details.savedPath),
    ...outputSection("Revised prompt", details.revisedPrompt),
    ...outputSection("Result", details.result),
  ];
}

function hookRunDetails(item: HookMessageStreamItem): DetailSection[] {
  const details = item.hookRun;
  if (!details) return [];
  const rows = [
    ...metaRow("status", item.status),
    { key: "event", value: details.eventName },
    ...metaRow("message", details.statusMessage),
    ...metaRow("duration", details.durationMs),
  ];
  const entries = details.entries.map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  return [{ kind: "kv", rows }, ...outputSection("Hook output", entries)];
}

function outputSection(title: string, body: string | null | undefined): DetailSection[] {
  return body ? [{ kind: "output", title, body }] : [];
}

function jsonOutputSection(title: string, value: unknown): DetailSection[] {
  return value === null || value === undefined ? [] : outputSection(title, jsonPreview(value));
}

function metaRow(key: string, value: string | null | undefined): { key: string; value: string }[] {
  return value ? [{ key, value }] : [];
}

function primaryTargetSummary(target: MessageStreamPrimaryTarget | undefined, workspaceRoot?: string | null): string | null {
  if (!target) return null;
  if (target.kind === "path") return pathRelativeToRoot(target.path, workspaceRoot);
  return target.value;
}

function textField(item: MessageStreamItem): string | null {
  return "text" in item && typeof item.text === "string" && item.text.trim().length > 0 ? item.text : null;
}

function outputField(item: MessageStreamItem): string | null {
  return "output" in item && typeof item.output === "string" && item.output.trim().length > 0 ? item.output : null;
}

function stringField(item: MessageStreamItem, key: "failureReason" | "operation" | "status" | "toolName"): string | null {
  if (!(key in item)) return null;
  const value = (item as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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

function fallbackSummary(item: MessageStreamItem): string {
  return textField(item) ?? "details";
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

function genericDetailSummary(item: MessageStreamItem, workspaceRoot?: string | null): string {
  const target = primaryTargetSummary(primaryTargetField(item), workspaceRoot);
  return compactSummary(null, target ?? textField(item) ?? outputField(item) ?? stringField(item, "status") ?? item.kind);
}

function detailLabel(item: MessageStreamItem): string {
  return stringField(item, "toolName") ?? item.kind;
}

function primaryTargetField(item: MessageStreamItem): MessageStreamPrimaryTarget | undefined {
  if (!("primaryTarget" in item)) return undefined;
  return item.primaryTarget;
}

function genericToolSummary(item: ToolCallMessageStreamItem | HookMessageStreamItem, workspaceRoot?: string | null): string {
  const target = primaryTargetSummary(item.primaryTarget, workspaceRoot);
  if (!target) return item.text ?? "details";
  return compactSummary(toolOperationLabel(item.operation), target, statusQualifier(item.status, item.failureReason));
}

function fileChangeSummary(item: FileChangeMessageStreamItem, changes: (MessageStreamFileChange & { displayPath: string })[]): string {
  const target = fileChangeTargetSummary(changes);
  return compactSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status)));
}

function agentSummaryText(item: AgentMessageStreamItem): string {
  const target = item.receiverThreadIds.length === 0 ? "" : ` ${item.receiverThreadIds.map(shortThreadId).join(", ")}`;
  const promptPreview = agentPromptPreview(item.prompt);
  return `${agentActivityMetaLabel(item.tool)}${target}${promptPreview ? `: ${promptPreview}` : ""} (${item.status})`;
}

function agentActivityMetaLabel(tool: string): string {
  if (tool === "spawnAgent") return "spawn";
  if (tool === "sendInput") return "send input";
  if (tool === "resumeAgent") return "resume";
  if (tool === "wait") return "wait";
  if (tool === "closeAgent") return "close";
  return tool;
}

function agentPromptPreview(prompt: string | null): string | null {
  if (!prompt) return null;
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized ? truncate(normalized, AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT) : null;
}

function agentStatusLabel(status: string, message: string | null): string {
  const preview = agentMessagePreview(message, AGENT_ROW_MESSAGE_PREVIEW_LIMIT);
  return preview ? `${status}: ${preview}` : status;
}

function agentMessagePreview(message: string | null, maxLength: number): string | null {
  if (!message) return null;
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return truncate(firstLine.replace(/\s+/g, " "), maxLength);
}

function isLongAgentMessage(message: string): boolean {
  return message.length > AGENT_ROW_MESSAGE_PREVIEW_LIMIT || message.includes("\n");
}

function fileChangeTargetSummary(changes: (MessageStreamFileChange & { displayPath: string })[]): string {
  if (changes.length === 0) return "no files";
  if (changes.length === 1) return changes[0]?.displayPath ?? "1 file";
  return `${String(changes.length)} files`;
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
