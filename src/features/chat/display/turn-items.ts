import type { DisplayDetailSection, DisplayFileChange, DisplayFileMention, DisplayItem, ExecutionState } from "./types";
import type { HistoricalTurn } from "../../../domain/threads/history";
import type { FileUpdateChange, TurnItem } from "../../../app-server/protocol/turn";
import { definedProp, truncate } from "../../../utils";
import { referencedThreadDisplayFromPrompt, type ReferencedThreadDisplay } from "../../../domain/threads/reference";
import { turnUserItemText } from "../../../app-server/protocol/turn";
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

type UserMessageItem = Extract<TurnItem, { type: "userMessage" }>;
type AgentMessageItem = Extract<TurnItem, { type: "agentMessage" }>;
type PlanItem = Extract<TurnItem, { type: "plan" }>;
type HookPromptItem = Extract<TurnItem, { type: "hookPrompt" }>;
type ReasoningItem = Extract<TurnItem, { type: "reasoning" }>;
type CommandExecutionItem = Extract<TurnItem, { type: "commandExecution" }>;
type CommandAction = CommandExecutionItem["commandActions"][number];
type FileChangeItem = Extract<TurnItem, { type: "fileChange" }>;
type McpToolCallItem = Extract<TurnItem, { type: "mcpToolCall" }>;
type DynamicToolCallItem = Extract<TurnItem, { type: "dynamicToolCall" }>;
type WebSearchItem = Extract<TurnItem, { type: "webSearch" }>;
type ImageViewItem = Extract<TurnItem, { type: "imageView" }>;
type ImageGenerationItem = Extract<TurnItem, { type: "imageGeneration" }>;
type ReviewModeItem = Extract<TurnItem, { type: "enteredReviewMode" }> | Extract<TurnItem, { type: "exitedReviewMode" }>;
type ContextCompactionItem = Extract<TurnItem, { type: "contextCompaction" }>;
type DisplayExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, DisplayExecutionState>>;
interface BaseDisplayData {
  id: string;
}

interface UserMessageDisplayData extends BaseDisplayData {
  text: string;
  displayText: string;
  clientId: string | null;
  mentionedFiles: DisplayFileMention[];
  referencedThread: {
    text: string;
    displayText: string;
    reference: ReferencedThreadDisplay;
  } | null;
}

interface MessageDisplayData extends BaseDisplayData {
  text: string;
}

interface ToolDisplayData extends BaseDisplayData {
  text: string;
  toolLabel?: string;
  status?: string;
  output?: string;
  details?: DisplayDetailSection[];
  executionState?: ExecutionState;
  summaryPath?: boolean;
}

interface CommandDisplayData extends BaseDisplayData {
  actionLabel: string;
  text: string;
  command: string;
  cwd: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  output: string;
  executionState: ExecutionState;
}

interface FileChangeDisplayData extends BaseDisplayData {
  text: string;
  status: string;
  changes: DisplayFileChange[];
  executionState: ExecutionState;
}

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

export function displayItemsFromTurns(turns: readonly HistoricalTurn<TurnItem>[]): DisplayItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: DisplayItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items) {
      const displayItem = displayItemFromTurnItem(item, turn.id);
      if (displayItem) items.push(displayItem);
    }
  }
  return items;
}

export function displayItemFromTurnItem(item: TurnItem, turnId?: string): DisplayItem | null {
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
  return userMessageDisplayItemFromData(userMessageDisplayDataFromItem(item), turnId);
}

function userMessageDisplayDataFromItem(item: UserMessageItem): UserMessageDisplayData {
  const text = turnUserItemText(item);
  const referencedThread = referencedThreadDisplayFromPrompt(text);
  return {
    id: item.id,
    text,
    displayText: userMessageDisplayText(text, item.content),
    clientId: item.clientId,
    mentionedFiles: fileMentionsFromInput(item.content),
    referencedThread: referencedThread
      ? {
          text: referencedThread.text,
          displayText: userMessageDisplayText(referencedThread.text, item.content),
          reference: referencedThread.reference,
        }
      : null,
  };
}

function userMessageDisplayItemFromData(data: UserMessageDisplayData, turnId?: string): DisplayItem {
  if (data.referencedThread) {
    return {
      id: data.id,
      kind: "message",
      messageKind: "user",
      role: "user",
      text: data.referencedThread.displayText,
      copyText: data.referencedThread.text,
      referencedThread: data.referencedThread.reference,
      ...definedProp("turnId", turnId),
      ...definedProp("clientId", data.clientId),
      sourceItemId: data.id,
      ...(data.mentionedFiles.length > 0 ? { mentionedFiles: data.mentionedFiles } : {}),
    };
  }
  return {
    id: data.id,
    kind: "message",
    messageKind: "user",
    role: "user",
    text: data.displayText,
    copyText: data.text,
    ...definedProp("turnId", turnId),
    ...definedProp("clientId", data.clientId),
    sourceItemId: data.id,
    ...(data.mentionedFiles.length > 0 ? { mentionedFiles: data.mentionedFiles } : {}),
  };
}

function agentMessageDisplayItem(item: AgentMessageItem, turnId?: string): DisplayItem {
  return assistantResponseDisplayItemFromData(agentMessageDisplayDataFromItem(item), turnId);
}

function agentMessageDisplayDataFromItem(item: AgentMessageItem): MessageDisplayData {
  return { id: item.id, text: item.text };
}

function assistantResponseDisplayItemFromData(data: MessageDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "message",
    messageKind: "assistantResponse",
    role: "assistant",
    text: data.text,
    copyText: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    messageState: "completed",
  };
}

function planDisplayItem(item: PlanItem, turnId?: string): DisplayItem {
  return proposedPlanDisplayItemFromData(planDisplayDataFromItem(item), turnId);
}

function planDisplayDataFromItem(item: PlanItem): MessageDisplayData {
  const text = normalizeProposedPlanMarkdown(item.text);
  return { id: item.id, text };
}

function proposedPlanDisplayItemFromData(data: MessageDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "message",
    messageKind: "proposedPlan",
    role: "assistant",
    text: data.text,
    copyText: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    messageState: "completed",
  };
}

function hookPromptDisplayItem(item: HookPromptItem, turnId?: string): DisplayItem {
  return hookPromptDisplayItemFromData(hookPromptDisplayDataFromItem(item), turnId);
}

function hookPromptDisplayDataFromItem(item: HookPromptItem): MessageDisplayData {
  return { id: item.id, text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt" };
}

function hookPromptDisplayItemFromData(data: MessageDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "hook",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
  };
}

function reasoningDisplayItem(item: ReasoningItem, turnId?: string): DisplayItem {
  return reasoningDisplayItemFromData(reasoningDisplayDataFromItem(item), turnId);
}

function reasoningDisplayDataFromItem(item: ReasoningItem): MessageDisplayData {
  return { id: item.id, text: reasoningText(item) };
}

function reasoningDisplayItemFromData(data: MessageDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "reasoning",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
  };
}

function mcpToolCallDisplayItem(item: McpToolCallItem, turnId?: string): DisplayItem {
  return toolDisplayItemFromData(mcpToolCallDisplayDataFromItem(item), turnId);
}

function mcpToolCallDisplayDataFromItem(item: McpToolCallItem): ToolDisplayData {
  const name = `${item.server}.${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  const failure = item.error?.message ? truncate(item.error.message, 96) : failedStatusLabel(item.status);
  return {
    id: item.id,
    text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
    toolLabel: name,
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

function toolDisplayItemFromData(data: ToolDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "tool",
    role: "tool",
    text: data.text,
    ...definedProp("toolLabel", data.toolLabel),
    ...definedProp("summaryPath", data.summaryPath),
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    ...definedProp("status", data.status),
    ...definedProp("details", data.details),
    ...definedProp("output", data.output),
    ...("executionState" in data ? { executionState: data.executionState } : {}),
  };
}

function dynamicToolCallDisplayItem(item: DynamicToolCallItem, turnId?: string): DisplayItem {
  return toolDisplayItemFromData(dynamicToolCallDisplayDataFromItem(item), turnId);
}

function dynamicToolCallDisplayDataFromItem(item: DynamicToolCallItem): ToolDisplayData {
  const name = `${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  const failure = item.success === false ? "failed" : failedStatusLabel(item.status);
  return {
    id: item.id,
    text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
    toolLabel: name,
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
  return toolDisplayItemFromData(webSearchDisplayDataFromItem(item), turnId);
}

function webSearchDisplayDataFromItem(item: WebSearchItem): ToolDisplayData {
  return {
    id: item.id,
    text: webSearchSummary(item),
    toolLabel: "web search",
    details: webSearchDetails(item),
    output: "",
  };
}

function imageViewDisplayItem(item: ImageViewItem, turnId?: string): DisplayItem {
  return toolDisplayItemFromData(imageViewDisplayDataFromItem(item), turnId);
}

function imageViewDisplayDataFromItem(item: ImageViewItem): ToolDisplayData {
  return {
    id: item.id,
    text: compactToolSummary(null, item.path),
    toolLabel: "imageView",
    summaryPath: true,
  };
}

function imageGenerationDisplayItem(item: ImageGenerationItem, turnId?: string): DisplayItem {
  return toolDisplayItemFromData(imageGenerationDisplayDataFromItem(item), turnId);
}

function imageGenerationDisplayDataFromItem(item: ImageGenerationItem): ToolDisplayData {
  const target = item.savedPath ?? item.result;
  return {
    id: item.id,
    text: compactToolSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status))),
    toolLabel: "imageGeneration",
    summaryPath: Boolean(item.savedPath),
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
  return toolDisplayItemFromData(reviewModeDisplayDataFromItem(item), turnId);
}

function reviewModeDisplayDataFromItem(item: ReviewModeItem): ToolDisplayData {
  return {
    id: item.id,
    text: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode",
    toolLabel: item.type,
    output: item.review,
  };
}

function contextCompactionDisplayItem(item: ContextCompactionItem, turnId?: string): DisplayItem {
  return contextCompactionDisplayItemFromData(contextCompactionDisplayDataFromItem(item), turnId);
}

function contextCompactionDisplayDataFromItem(item: ContextCompactionItem): MessageDisplayData {
  return { id: item.id, text: "Context compaction" };
}

function contextCompactionDisplayItemFromData(data: MessageDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "contextCompaction",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
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
  return commandDisplayItemFromData(commandDisplayDataFromItem(item), turnId);
}

function commandDisplayDataFromItem(item: CommandExecutionItem): CommandDisplayData {
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
  const target = commandTargetLabel(item);
  const qualifier =
    typeof exitCode === "number" && exitCode !== 0
      ? `exit ${String(exitCode)}`
      : statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    actionLabel: commandActionLabel(item),
    text: compactToolSummary(null, target, qualifier),
    command: item.command,
    cwd: item.cwd,
    status: item.status,
    ...definedProp("exitCode", exitCode),
    ...definedProp("durationMs", durationMs),
    output: item.aggregatedOutput ?? "",
    executionState: commandExecutionState(item.status, exitCode),
  };
}

function commandDisplayItemFromData(data: CommandDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "command",
    role: "tool",
    actionLabel: data.actionLabel,
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    command: data.command,
    cwd: data.cwd,
    status: data.status,
    ...definedProp("exitCode", data.exitCode),
    ...definedProp("durationMs", data.durationMs),
    output: data.output,
    executionState: data.executionState,
  };
}

function fileChangeDisplayItem(item: FileChangeItem, turnId?: string): DisplayItem {
  return fileChangeDisplayItemFromData(fileChangeDisplayDataFromItem(item), turnId);
}

function fileChangeDisplayDataFromItem(item: FileChangeItem): FileChangeDisplayData {
  const changes = normalizeFileChanges(item.changes);
  const qualifier = statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    text: compactToolSummary(null, fileChangeTargetLabel(changes), qualifier),
    status: item.status,
    changes,
    executionState: patchApplyExecutionState(item.status),
  };
}

function fileChangeDisplayItemFromData(data: FileChangeDisplayData, turnId?: string): DisplayItem {
  return {
    id: data.id,
    kind: "fileChange",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    status: data.status,
    changes: data.changes,
    executionState: data.executionState,
  };
}

export function normalizeFileChanges(changes: FileUpdateChange[]): DisplayFileChange[] {
  return changes.map((change) => ({
    kind: change.kind.type,
    path: change.path,
    diff: change.diff,
  }));
}

export function shouldSuppressLifecycleItem(item: TurnItem): boolean {
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

function imageGenerationExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

function standardToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
