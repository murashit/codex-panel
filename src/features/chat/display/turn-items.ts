import type { DisplayDetailSection, DisplayFileChange, DisplayItem, ExecutionState } from "./types";
import type { AppServerFileUpdateChange, AppServerThreadItem, AppServerTurn } from "../../../app-server/turn-model";
import { definedProp, truncate } from "../../../utils";
import { referencedThreadDisplayFromPrompt } from "../../../domain/threads/reference";
import { appServerUserItemText } from "../../../app-server/turn-model";
import { agentDisplayItem } from "./items/agent";
import { pathRelativeToRoot } from "./details/path-labels";
import { normalizeProposedPlanMarkdown } from "./items/proposed-plan";
import { fileMentionsFromInput, userMessageDisplayText } from "./items/user-message";
import {
  bodyDetail,
  compactToolSummary,
  failedStatusLabel,
  jsonDetails,
  jsonTargetLabel,
  metaDetail,
  statusQualifier,
} from "./details/tool-details";

type UserMessageItem = Extract<AppServerThreadItem, { type: "userMessage" }>;
type AgentMessageItem = Extract<AppServerThreadItem, { type: "agentMessage" }>;
type PlanItem = Extract<AppServerThreadItem, { type: "plan" }>;
type HookPromptItem = Extract<AppServerThreadItem, { type: "hookPrompt" }>;
type ReasoningItem = Extract<AppServerThreadItem, { type: "reasoning" }>;
type CommandExecutionItem = Extract<AppServerThreadItem, { type: "commandExecution" }>;
type CommandAction = CommandExecutionItem["commandActions"][number];
type FileChangeItem = Extract<AppServerThreadItem, { type: "fileChange" }>;
type McpToolCallItem = Extract<AppServerThreadItem, { type: "mcpToolCall" }>;
type DynamicToolCallItem = Extract<AppServerThreadItem, { type: "dynamicToolCall" }>;
type WebSearchItem = Extract<AppServerThreadItem, { type: "webSearch" }>;
type ImageViewItem = Extract<AppServerThreadItem, { type: "imageView" }>;
type ImageGenerationItem = Extract<AppServerThreadItem, { type: "imageGeneration" }>;
type ReviewModeItem =
  | Extract<AppServerThreadItem, { type: "enteredReviewMode" }>
  | Extract<AppServerThreadItem, { type: "exitedReviewMode" }>;
type ContextCompactionItem = Extract<AppServerThreadItem, { type: "contextCompaction" }>;
type DisplayExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, DisplayExecutionState>>;

const COMMAND_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const PATCH_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const STANDARD_TOOL_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

export function displayItemsFromTurns(turns: readonly AppServerTurn[]): DisplayItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: DisplayItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items) {
      const displayItem = displayItemFromThreadItem(item, turn.id);
      if (displayItem) items.push(displayItem);
    }
  }
  return items;
}

export function displayItemFromThreadItem(item: AppServerThreadItem, turnId?: string): DisplayItem | null {
  switch (item.type) {
    case "userMessage":
      return userMessageDisplayItem(item, turnId);
    case "agentMessage":
      return agentMessageDisplayItem(item, turnId);
    case "commandExecution":
      return commandDisplayItem(item, turnId);
    case "fileChange":
      return fileChangeDisplayItem(item, turnId);
    case "plan":
      return planDisplayItem(item, turnId);
    case "hookPrompt":
      return hookPromptDisplayItem(item, turnId);
    case "reasoning":
      return reasoningDisplayItem(item, turnId);
    case "mcpToolCall":
      return mcpToolCallDisplayItem(item, turnId);
    case "dynamicToolCall":
      return dynamicToolCallDisplayItem(item, turnId);
    case "collabAgentToolCall":
      return agentDisplayItem(item, turnId);
    case "webSearch":
      return webSearchDisplayItem(item, turnId);
    case "imageView":
      return imageViewDisplayItem(item, turnId);
    case "imageGeneration":
      return imageGenerationDisplayItem(item, turnId);
    case "enteredReviewMode":
    case "exitedReviewMode":
      return reviewModeDisplayItem(item, turnId);
    case "contextCompaction":
      return contextCompactionDisplayItem(item, turnId);
    default:
      return assertNever(item);
  }
}

function userMessageDisplayItem(item: UserMessageItem, turnId?: string): DisplayItem {
  const text = appServerUserItemText(item);
  const displayText = userMessageDisplayText(text, item.content);
  const mentionedFiles = fileMentionsFromInput(item.content);
  const referencedThread = referencedThreadDisplayFromPrompt(text);
  if (referencedThread) {
    return {
      id: item.id,
      kind: "message",
      messageKind: "user",
      role: "user",
      text: userMessageDisplayText(referencedThread.text, item.content),
      copyText: referencedThread.text,
      referencedThread: referencedThread.reference,
      ...definedProp("turnId", turnId),
      ...definedProp("clientId", item.clientId),
      sourceItemId: item.id,
      ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
    };
  }
  return {
    id: item.id,
    kind: "message",
    messageKind: "user",
    role: "user",
    text: displayText,
    copyText: text,
    ...definedProp("turnId", turnId),
    ...definedProp("clientId", item.clientId),
    sourceItemId: item.id,
    ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
  };
}

function agentMessageDisplayItem(item: AgentMessageItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "message",
    messageKind: "assistantResponse",
    role: "assistant",
    text: item.text,
    copyText: item.text,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    messageState: "completed",
  };
}

function planDisplayItem(item: PlanItem, turnId?: string): DisplayItem {
  const text = normalizeProposedPlanMarkdown(item.text);
  return {
    id: item.id,
    kind: "message",
    messageKind: "proposedPlan",
    role: "assistant",
    text,
    copyText: text,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    messageState: "completed",
  };
}

function hookPromptDisplayItem(item: HookPromptItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "hook",
    role: "tool",
    text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt",
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
  };
}

function reasoningDisplayItem(item: ReasoningItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "reasoning",
    role: "tool",
    text: reasoningText(item),
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
  };
}

function mcpToolCallDisplayItem(item: McpToolCallItem, turnId?: string): DisplayItem {
  const name = `${item.server}.${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  const failure = item.error?.message ? truncate(item.error.message, 96) : failedStatusLabel(item.status);
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
    toolLabel: name,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    status: item.status,
    details: jsonDetails([
      ["Arguments JSON", item.arguments],
      ["Result JSON", item.result],
      ["Error JSON", item.error],
    ]),
    output: "",
    executionState: mcpToolCallExecutionState(item.status),
  };
}

function dynamicToolCallDisplayItem(item: DynamicToolCallItem, turnId?: string): DisplayItem {
  const name = `${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  const failure = item.success === false ? "failed" : failedStatusLabel(item.status);
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
    toolLabel: name,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    status: item.status,
    details: jsonDetails([
      ["Arguments JSON", item.arguments],
      ["Result JSON", item.contentItems],
    ]),
    output: "",
    executionState: dynamicToolCallExecutionState(item.status, item.success),
  };
}

function webSearchDisplayItem(item: WebSearchItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: webSearchSummary(item),
    toolLabel: "web search",
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    details: webSearchDetails(item),
    output: "",
  };
}

function imageViewDisplayItem(item: ImageViewItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: compactToolSummary(null, item.path),
    toolLabel: "imageView",
    summaryPath: true,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
  };
}

function imageGenerationDisplayItem(item: ImageGenerationItem, turnId?: string): DisplayItem {
  const target = item.savedPath ?? item.result;
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: compactToolSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status))),
    toolLabel: "imageGeneration",
    summaryPath: Boolean(item.savedPath),
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    status: item.status,
    details: [
      ...bodyDetail("Saved path", item.savedPath),
      ...bodyDetail("Revised prompt", item.revisedPrompt),
      ...bodyDetail("Result", item.result),
    ],
    output: "",
    executionState: imageGenerationExecutionState(item.status),
  };
}

function reviewModeDisplayItem(item: ReviewModeItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode",
    toolLabel: item.type,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    output: item.review,
  };
}

function contextCompactionDisplayItem(item: ContextCompactionItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "contextCompaction",
    role: "tool",
    text: "Context compaction",
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
  };
}

function reasoningText(item: ReasoningItem): string {
  return [...item.summary, ...item.content]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function commandTargetLabel(item: CommandExecutionItem): string {
  const action = representativeCommandAction(item.commandActions);
  if (action?.type === "search") {
    const query = commandActionValue(action.query);
    const path = commandActionPathLabel(action.path, item.cwd);
    if (query && path) return `${quoteInline(query)} in ${path}`;
    if (query) return quoteInline(query);
    if (path) return path;
  }
  if (action?.type === "read") return commandReadTargetLabel(action, item.cwd);
  if (action?.type === "listFiles") return commandActionPathLabel(action.path, item.cwd) ?? "workspace";
  return unwrapShellLoginCommand(firstCommandLine(item.command));
}

function commandActionLabel(item: CommandExecutionItem): string {
  const action = representativeCommandAction(item.commandActions);
  if (action?.type === "read") return "read";
  if (action?.type === "search") return "search";
  if (action?.type === "listFiles") return "list files";
  return "command";
}

function representativeCommandAction(actions: CommandAction[]): CommandAction | null {
  return (
    actions.find((action) => action.type === "read") ??
    actions.find((action) => action.type === "search") ??
    actions.find((action) => action.type === "listFiles") ??
    actions.at(0) ??
    null
  );
}

function commandActionValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

function commandActionPathLabel(value: string | null, cwd: string): string | null {
  const path = commandActionValue(value);
  return path ? pathRelativeToWorkspace(path, cwd) : null;
}

function commandReadTargetLabel(action: Extract<CommandAction, { type: "read" }>, cwd: string): string {
  const path = commandActionValue(action.path);
  if (path) return pathRelativeToWorkspace(path, cwd);
  return action.name;
}

function firstCommandLine(command: string): string {
  return (
    command
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? command.trim()
  );
}

function unwrapShellLoginCommand(command: string): string {
  const match = /^(?:\/bin\/)?zsh\s+-lc\s+(.+)$/.exec(command);
  if (!match) return command;
  const shellCommand = match[1];
  return shellCommand === undefined ? command : unquoteShellCommand(shellCommand.trim());
}

function unquoteShellCommand(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || !value.endsWith(quote)) return value;
  const inner = value.slice(1, -1);
  return quote === "'" ? inner.replace(/'\\''/g, "'") : inner.replace(/\\(["\\$`])/g, "$1");
}

function quoteInline(value: string): string {
  return value.includes(" ") ? JSON.stringify(value) : value;
}

function fileChangeTargetLabel(changes: DisplayFileChange[]): string {
  if (changes.length === 0) return "no files";
  if (changes.length === 1) return changes[0]?.path ?? "1 file";
  return `${String(changes.length)} files`;
}

function webSearchTarget(item: WebSearchItem): string | null {
  if (item.action?.type === "openPage") return item.action.url;
  if (item.action?.type === "findInPage") return item.action.pattern ?? item.action.url;
  if (item.action?.type === "search") return webSearchQueryList(item.action.query, item.action.queries, item.query);
  return item.query;
}

function webSearchSummary(item: WebSearchItem): string {
  const actionType = item.action?.type ?? (item.query ? "search" : "web search");
  const label = webSearchActionLabel(actionType);
  return compactToolSummary(label, webSearchTarget(item));
}

function webSearchActionLabel(actionType: string): string {
  if (actionType === "openPage") return "open page";
  if (actionType === "findInPage") return "find in page";
  if (actionType === "search") return "search";
  if (actionType === "other") return "other";
  return actionType;
}

function webSearchQueryList(
  query: string | null | undefined,
  queries: string[] | null | undefined,
  fallback?: string | null,
): string | null {
  const values = [query, ...(queries ?? []), fallback].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const unique = [...new Set(values)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0] ?? null;
  return unique.join("; ");
}

function webSearchDetails(item: WebSearchItem): DisplayDetailSection[] {
  const rows: { key: string; value: string }[] = [];
  if (item.action) rows.push({ key: "action", value: webSearchActionLabel(item.action.type) });
  if (item.action?.type === "search") {
    const queries = webSearchQueryList(item.action.query, item.action.queries, item.query);
    if (queries) rows.push({ key: "query", value: queries });
  } else if (item.action?.type === "openPage") {
    if (item.action.url) rows.push({ key: "url", value: item.action.url });
  } else if (item.action?.type === "findInPage") {
    if (item.action.pattern) rows.push({ key: "pattern", value: item.action.pattern });
    if (item.action.url) rows.push({ key: "url", value: item.action.url });
  } else if (item.query) {
    rows.push({ key: "query", value: item.query });
  }

  return metaDetail("web search", rows);
}

function commandDisplayItem(item: CommandExecutionItem, turnId?: string): DisplayItem {
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
  const target = commandTargetLabel(item);
  const qualifier =
    typeof exitCode === "number" && exitCode !== 0
      ? `exit ${String(exitCode)}`
      : statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    kind: "command",
    role: "tool",
    actionLabel: commandActionLabel(item),
    text: compactToolSummary(null, target, qualifier),
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    command: item.command,
    cwd: item.cwd,
    status: item.status,
    ...definedProp("exitCode", exitCode),
    ...definedProp("durationMs", durationMs),
    output: item.aggregatedOutput ?? "",
    executionState: commandExecutionState(item.status, exitCode),
  };
}

function fileChangeDisplayItem(item: FileChangeItem, turnId?: string): DisplayItem {
  const changes = normalizeFileChanges(item.changes);
  const qualifier = statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    kind: "fileChange",
    role: "tool",
    text: compactToolSummary(null, fileChangeTargetLabel(changes), qualifier),
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    status: item.status,
    changes,
    executionState: patchApplyExecutionState(item.status),
  };
}

export function normalizeFileChanges(changes: AppServerFileUpdateChange[]): DisplayFileChange[] {
  return changes.map((change) => ({
    kind: change.kind.type,
    path: change.path,
    diff: change.diff,
  }));
}

export function shouldSuppressLifecycleItem(item: AppServerThreadItem): boolean {
  return item.type === "agentMessage" || item.type === "userMessage";
}

function pathRelativeToWorkspace(path: string, workspaceRoot?: string | null): string {
  return pathRelativeToRoot(path, workspaceRoot);
}

function assertNever(_item: never): null {
  return null;
}

export function commandExecutionState(status: string, exitCode?: number): ExecutionState {
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  const state = executionStateFromStatus(status, COMMAND_STATES);
  if (state) return state;
  if (typeof exitCode === "number") return "completed";
  return null;
}

export function patchApplyExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, PATCH_STATES);
}

export function mcpToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function dynamicToolCallExecutionState(status: string, success?: boolean | null): ExecutionState {
  if (success === false) return "failed";
  const state = standardToolCallExecutionState(status);
  if (state) return state;
  return success === true ? "completed" : null;
}

export function imageGenerationExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

function standardToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
