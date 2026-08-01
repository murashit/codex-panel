import { truncate } from "../../../../domain/display/text-preview";
import { shortThreadId } from "../../../../domain/threads/id";
import { pathRelativeToRoot } from "../../../../domain/vault/paths";
import { agentMessagePreview } from "../../domain/thread-stream/format/agent-message-preview";
import type {
  AgentThreadStreamItem,
  ApprovalResultThreadStreamItem,
  CommandThreadStreamItem,
  CommandThreadStreamTarget,
  FileChangeThreadStreamItem,
  GoalThreadStreamItem,
  HookThreadStreamItem,
  ReviewResultThreadStreamItem,
  ThreadStreamFileChange,
  ThreadStreamItem,
  ThreadStreamPrimaryTarget,
  ToolCallThreadStreamItem,
} from "../../domain/thread-stream/items";
import type { DetailSection, DetailView } from "../../ui/thread-stream/model";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;
const AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT = 96;

export function detailView(item: ThreadStreamItem, workspaceRoot: string): DetailView {
  return codexDetailView(item, workspaceRoot) ?? genericDetailView(item, workspaceRoot);
}

export function detailPreviewSummary(item: ThreadStreamItem, workspaceRoot: string): string {
  let summary: string;
  let label: string;
  switch (item.kind) {
    case "command":
      summary = commandSummary(item);
      label = commandActionLabel(item.commandAction);
      break;
    case "fileChange": {
      const displayChanges = fileChangeDisplayChanges(item, workspaceRoot);
      summary = fileChangeSummary(item, displayChanges);
      label = "file change";
      break;
    }
    case "goal":
      summary = fallbackSummary(item);
      label = "goal";
      break;
    case "approvalResult":
      summary = fallbackSummary(item);
      label = "approval";
      break;
    case "reviewResult":
      summary = fallbackSummary(item);
      label = "auto-review";
      break;
    case "agent":
      summary = agentSummaryText(item);
      label = "agent";
      break;
    case "tool":
    case "hook":
      summary = genericToolSummary(item, workspaceRoot);
      label = item.toolName ?? item.kind;
      break;
    default:
      summary = genericDetailSummary(item, workspaceRoot);
      label = detailLabel(item);
  }
  return summary !== "details" ? summary : (outputField(item) ?? label);
}

function codexDetailView(item: ThreadStreamItem, workspaceRoot: string): DetailView | null {
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
  item: ThreadStreamItem,
  className: string,
  label: string,
  detailsKey: string,
  sections: DetailSection[],
  summary = fallbackSummary(item),
  summaryThreadIds: readonly string[] = [],
): DetailView {
  return {
    className: `codex-panel__stream-item codex-panel__stream-item--tool ${className}`,
    label,
    summary,
    summaryThreadIds,
    detailsKey,
    sections,
    state: item.executionState ?? null,
  };
}

function commandDetailView(item: CommandThreadStreamItem): DetailView {
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

function fileChangeDetailView(item: FileChangeThreadStreamItem, workspaceRoot: string): DetailView {
  const displayChanges = fileChangeDisplayChanges(item, workspaceRoot);
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

function fileChangeDisplayChanges(
  item: FileChangeThreadStreamItem,
  workspaceRoot: string,
): (ThreadStreamFileChange & { displayPath: string })[] {
  return item.changes.map((change) => ({
    ...change,
    displayPath: change.path && change.path !== "(unknown)" ? pathRelativeToRoot(change.path, workspaceRoot) : change.path,
  }));
}

function goalDetailView(item: GoalThreadStreamItem): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__detail-item--goal",
    "goal",
    itemDetailKey(item.id, "goal-details"),
    goalDetails(item),
  );
}

function agentDetailView(item: AgentThreadStreamItem): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__agent-activity",
    "agent",
    itemDetailKey(item.id, "agent-details"),
    agentDetailSections(item),
    agentSummaryText(item),
    agentThreadIds(item),
  );
}

function genericToolDetailView(item: ToolCallThreadStreamItem | HookThreadStreamItem, workspaceRoot: string): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item",
    item.toolName ?? item.kind,
    itemDetailKey(item.id, "details"),
    [...genericToolDetails(item), ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output)],
    genericToolSummary(item, workspaceRoot),
  );
}

function reviewDetailView(item: ReviewResultThreadStreamItem): DetailView {
  return resultDetailView(
    item,
    "auto-review",
    itemDetailKey(item.id, "review-details"),
    "codex-panel__stream-item--review-result codex-panel__detail-item--review",
  );
}

function approvalDetailView(item: ApprovalResultThreadStreamItem): DetailView {
  return resultDetailView(
    item,
    "approval",
    itemDetailKey(item.id, "approval-details"),
    "codex-panel__stream-item--approval-result codex-panel__detail-item--approval",
  );
}

function genericDetailView(item: ThreadStreamItem, workspaceRoot: string): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item",
    detailLabel(item),
    itemDetailKey(item.id, "details"),
    genericDetailSections(item, workspaceRoot),
    genericDetailSummary(item, workspaceRoot),
  );
}

function itemDetailKey(itemId: string, suffix: string): string {
  return `${itemId}:${suffix}`;
}

function resultDetailView(
  item: ApprovalResultThreadStreamItem | ReviewResultThreadStreamItem,
  label: string,
  detailsKey: string,
  className: string,
): DetailView {
  return detailViewBase(item, `codex-panel__detail-item ${className}`, label, detailsKey, resultDetails(item));
}

function goalDetails(item: GoalThreadStreamItem): DetailSection[] {
  return [
    {
      kind: "kv",
      rows: [{ key: "action", value: item.action }],
    },
    ...outputSection("Objective", item.objective),
  ];
}

function agentDetailSections(item: AgentThreadStreamItem): DetailSection[] {
  const rows = [
    { key: "tool", value: agentActivityMetaLabel(item.action) },
    { key: "status", value: item.status },
    ...(item.senderThreadId ? [{ key: "sender", value: item.senderThreadId }] : []),
    ...(item.targets.length > 0 ? [{ key: "target", value: item.targets.map(agentTargetLabel).join(", ") }] : []),
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

function agentStateSection(item: AgentThreadStreamItem): DetailSection[] {
  const rows = item.agents.map((agent) => ({
    key: shortThreadId(agent.threadId),
    value: agentStatusLabel(agent.status, agent.message),
  }));
  return rows.length > 0 ? [{ kind: "kv", title: "agents", rows }] : [];
}

function resultDetails(item: ApprovalResultThreadStreamItem | ReviewResultThreadStreamItem): DetailSection[] {
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

function genericToolDetails(item: ToolCallThreadStreamItem | HookThreadStreamItem): DetailSection[] {
  if (item.kind === "hook") return hookRunDetails(item);
  return [...diagnosticDetails(item), ...webSearchDetails(item), ...imageGenerationDetails(item)];
}

function genericDetailSections(item: ThreadStreamItem, workspaceRoot: string): DetailSection[] {
  const rows = [
    ...metaRow("kind", item.kind),
    ...metaRow("status", stringField(item, "status")),
    ...metaRow("operation", stringField(item, "operation")),
    ...metaRow("target", primaryTargetSummary(primaryTargetField(item), workspaceRoot)),
    ...metaRow("failure", stringField(item, "failureReason")),
  ];
  return [...(rows.length > 0 ? [{ kind: "kv" as const, rows }] : []), ...outputSection("Output", outputField(item))];
}

function diagnosticDetails(item: ToolCallThreadStreamItem): DetailSection[] {
  return item.diagnostics?.map((section) => ({ kind: "output" as const, title: section.title, body: section.body })) ?? [];
}

function webSearchDetails(item: ToolCallThreadStreamItem): DetailSection[] {
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

function imageGenerationDetails(item: ToolCallThreadStreamItem): DetailSection[] {
  const details = item.imageGeneration;
  if (!details) return [];
  return [
    ...outputSection("Saved path", details.savedPath),
    ...outputSection("Revised prompt", details.revisedPrompt),
    ...outputSection("Result", details.result),
  ];
}

function hookRunDetails(item: HookThreadStreamItem): DetailSection[] {
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

function metaRow(key: string, value: string | null | undefined): { key: string; value: string }[] {
  return value ? [{ key, value }] : [];
}

function outputField(item: ThreadStreamItem): string | null {
  return "output" in item && typeof item.output === "string" && item.output.trim().length > 0 ? item.output : null;
}
function primaryTargetField(item: ThreadStreamItem): ThreadStreamPrimaryTarget | undefined {
  if (!("primaryTarget" in item)) return undefined;
  return item.primaryTarget;
}

function primaryTargetSummary(target: ThreadStreamPrimaryTarget | undefined, workspaceRoot: string): string | null {
  if (!target) return null;
  if (target.kind === "path") return pathRelativeToRoot(target.path, workspaceRoot);
  return target.value;
}

function textField(item: ThreadStreamItem): string | null {
  return "text" in item && typeof item.text === "string" && item.text.trim().length > 0 ? item.text : null;
}

function stringField(item: ThreadStreamItem, key: "failureReason" | "operation" | "status" | "toolName"): string | null {
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

function fallbackSummary(item: ThreadStreamItem): string {
  return textField(item) ?? "details";
}

function commandActionLabel(action: CommandThreadStreamItem["commandAction"]): string {
  if (action === "read") return "read";
  if (action === "search") return "search";
  if (action === "listFiles") return "list files";
  return "command";
}

function commandSummary(item: CommandThreadStreamItem): string {
  return compactSummary(null, commandTargetSummary(item.commandTarget, item.cwd), commandQualifier(item));
}

function commandTargetSummary(target: CommandThreadStreamTarget, cwd: string): string {
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

function commandQualifier(item: CommandThreadStreamItem): string | null {
  if (typeof item.exitCode === "number" && item.exitCode !== 0) return `exit ${String(item.exitCode)}`;
  return statusQualifier(item.status, failedStatusLabel(item.status));
}

function genericDetailSummary(item: ThreadStreamItem, workspaceRoot: string): string {
  const target = primaryTargetSummary(primaryTargetField(item), workspaceRoot);
  return compactSummary(null, target ?? textField(item) ?? outputField(item) ?? stringField(item, "status") ?? item.kind);
}

function detailLabel(item: ThreadStreamItem): string {
  return stringField(item, "toolName") ?? item.kind;
}

function genericToolSummary(item: ToolCallThreadStreamItem | HookThreadStreamItem, workspaceRoot: string): string {
  const target = primaryTargetSummary(item.primaryTarget, workspaceRoot);
  if (!target) return item.text ?? "details";
  return compactSummary(toolOperationLabel(item.operation), target, statusQualifier(item.status, item.failureReason));
}

function fileChangeSummary(item: FileChangeThreadStreamItem, changes: (ThreadStreamFileChange & { displayPath: string })[]): string {
  const target = fileChangeTargetSummary(changes);
  return compactSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status)));
}

function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function agentSummaryText(item: AgentThreadStreamItem): string {
  const target = item.targets.length === 0 ? "" : ` ${item.targets.map(agentTargetLabel).join(", ")}`;
  const promptPreview = agentPromptPreview(item.prompt);
  return `${agentActivityMetaLabel(item.action)}${target}${promptPreview ? `: ${promptPreview}` : ""} (${item.status})`;
}

function agentThreadIds(item: AgentThreadStreamItem): readonly string[] {
  return [...new Set([...item.targets.map((target) => target.threadId), ...item.agents.map((agent) => agent.threadId)])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function agentTargetLabel(target: AgentThreadStreamItem["targets"][number]): string {
  return target.label ?? shortThreadId(target.threadId);
}

function agentActivityMetaLabel(tool: string): string {
  if (tool === "spawn") return "spawn";
  if (tool === "interact") return "interact with";
  if (tool === "resume") return "resume";
  if (tool === "wait") return "wait";
  if (tool === "close") return "close";
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

function isLongAgentMessage(message: string): boolean {
  return message.length > AGENT_ROW_MESSAGE_PREVIEW_LIMIT || message.includes("\n");
}

function fileChangeTargetSummary(changes: (ThreadStreamFileChange & { displayPath: string })[]): string {
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
