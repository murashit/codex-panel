import { shortThreadId, truncate } from "../../../../utils";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import type {
  AgentMessageStreamItem,
  ApprovalResultMessageStreamItem,
  CommandMessageStreamItem,
  CommandMessageStreamTarget,
  FileChangeMessageStreamItem,
  GoalMessageStreamItem,
  HookMessageStreamItem,
  MessageStreamFileChange,
  MessageStreamItem,
  ReviewResultMessageStreamItem,
  ToolCallMessageStreamItem,
} from "../../domain/message-stream/items";
import { agentActivityMetaLabel, agentMessagePreview } from "./agent-summary";
import {
  compactSummary,
  detailViewBase,
  failedStatusLabel,
  jsonOutputSection,
  metaRow,
  outputSection,
  primaryTargetSummary,
  statusQualifier,
  type DetailSection,
  type DetailView,
} from "./detail-types";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;
const AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT = 96;

export function codexDetailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView | null {
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
    `${item.id}:goal-details`,
    goalDetails(item),
  );
}

function agentDetailView(item: AgentMessageStreamItem): DetailView {
  return detailViewBase(
    item,
    "codex-panel__detail-item codex-panel__agent-activity",
    "agent",
    `${item.id}:agent-details`,
    agentDetailSections(item),
    agentSummaryText(item),
  );
}

function genericToolDetailView(item: ToolCallMessageStreamItem | HookMessageStreamItem, workspaceRoot?: string | null): DetailView {
  return detailViewBase(
    item,
    `codex-panel__detail-item codex-panel__detail-item--${item.kind}`,
    item.toolName ?? item.kind,
    `${item.id}:details`,
    [...genericToolDetails(item), ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output)],
    genericToolSummary(item, workspaceRoot),
  );
}

function reviewDetailView(item: ReviewResultMessageStreamItem): DetailView {
  return resultDetailView(
    item,
    "auto-review",
    `${item.id}:review-details`,
    "codex-panel__message--review-result codex-panel__detail-item--review",
  );
}

function approvalDetailView(item: ApprovalResultMessageStreamItem): DetailView {
  return resultDetailView(
    item,
    "approval",
    `${item.id}:approval-details`,
    "codex-panel__message--approval-result codex-panel__detail-item--approval",
  );
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

function fileChangeSummary(item: FileChangeMessageStreamItem, changes: (MessageStreamFileChange & { displayPath: string })[]): string {
  const target = fileChangeTargetSummary(changes);
  return compactSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status)));
}

function agentSummaryText(item: AgentMessageStreamItem): string {
  const target = item.receiverThreadIds.length === 0 ? "" : ` ${item.receiverThreadIds.map(shortThreadId).join(", ")}`;
  const promptPreview = agentPromptPreview(item.prompt);
  return `${agentActivityMetaLabel(item.tool)}${target}${promptPreview ? `: ${promptPreview}` : ""} (${item.status})`;
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
