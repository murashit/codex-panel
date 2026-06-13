import type {
  MessageStreamDetailSection,
  MessageStreamFileChange,
  MessageStreamFileMention,
  MessageStreamItem,
  ExecutionState,
} from "./items";
import type { HistoricalTurn } from "../../../domain/threads/history";
import type { FileUpdateChange, TurnItem } from "../../../app-server/protocol/turn";
import { definedProp, truncate } from "../../../utils";
import { referencedThreadMetadataFromPrompt, type ReferencedThreadMetadata } from "../../../domain/threads/reference";
import { turnUserItemText } from "../../../app-server/protocol/turn";
import { agentMessageStreamItem } from "./agent-items";
import { fileMentionsFromInput } from "./file-mentions";
import { normalizeProposedPlanMarkdown } from "./proposed-plan";
import { pathRelativeToRoot } from "./path-labels";
import { userMessageDisplayText } from "./user-message-text";
import {
  bodyDetail,
  compactToolSummary,
  failedStatusLabel,
  jsonDetails,
  jsonTargetLabel,
  metaDetail,
  statusQualifier,
} from "./detail-sections";

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
type MessageStreamExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, MessageStreamExecutionState>>;
interface BaseStreamItemData {
  id: string;
}

interface UserMessageStreamItemData extends BaseStreamItemData {
  text: string;
  displayText: string;
  clientId: string | null;
  mentionedFiles: MessageStreamFileMention[];
  referencedThread: {
    text: string;
    displayText: string;
    reference: ReferencedThreadMetadata;
  } | null;
}

interface MessageStreamTextData extends BaseStreamItemData {
  text: string;
}

interface ToolMessageStreamData extends BaseStreamItemData {
  text: string;
  toolLabel?: string;
  status?: string;
  output?: string;
  details?: MessageStreamDetailSection[];
  executionState?: ExecutionState;
  summaryPath?: boolean;
}

interface CommandMessageStreamData extends BaseStreamItemData {
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

interface FileChangeMessageStreamData extends BaseStreamItemData {
  text: string;
  status: string;
  changes: MessageStreamFileChange[];
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

export function messageStreamItemsFromTurns(turns: readonly HistoricalTurn<TurnItem>[]): MessageStreamItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: MessageStreamItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items) {
      const streamItem = messageStreamItemFromTurnItem(item, turn.id);
      if (streamItem) items.push(streamItem);
    }
  }
  return items;
}

export function messageStreamItemFromTurnItem(item: TurnItem, turnId?: string): MessageStreamItem | null {
  switch (item.type) {
    case "userMessage":
      return userMessageStreamItem(item, turnId);
    case "agentMessage":
      return assistantMessageStreamItemFromTurn(item, turnId);
    case "commandExecution":
      return commandMessageStreamItem(item, turnId);
    case "fileChange":
      return fileChangeMessageStreamItem(item, turnId);
    case "plan":
      return proposedPlanMessageStreamItem(item, turnId);
    case "hookPrompt":
      return hookPromptMessageStreamItem(item, turnId);
    case "reasoning":
      return reasoningMessageStreamItem(item, turnId);
    case "mcpToolCall":
      return mcpToolCallMessageStreamItem(item, turnId);
    case "dynamicToolCall":
      return dynamicToolCallMessageStreamItem(item, turnId);
    case "collabAgentToolCall":
      return agentMessageStreamItem(item, turnId);
    case "webSearch":
      return webSearchMessageStreamItem(item, turnId);
    case "imageView":
      return imageViewMessageStreamItem(item, turnId);
    case "imageGeneration":
      return imageGenerationMessageStreamItem(item, turnId);
    case "enteredReviewMode":
    case "exitedReviewMode":
      return reviewModeMessageStreamItem(item, turnId);
    case "contextCompaction":
      return contextCompactionMessageStreamItem(item, turnId);
    default:
      return assertNever(item);
  }
}

function userMessageStreamItem(item: UserMessageItem, turnId?: string): MessageStreamItem {
  return userMessageStreamItemFromData(userMessageStreamTextDataFromItem(item), turnId);
}

function userMessageStreamTextDataFromItem(item: UserMessageItem): UserMessageStreamItemData {
  const text = turnUserItemText(item);
  const referencedThread = referencedThreadMetadataFromPrompt(text);
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

function userMessageStreamItemFromData(data: UserMessageStreamItemData, turnId?: string): MessageStreamItem {
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

function assistantMessageStreamItemFromTurn(item: AgentMessageItem, turnId?: string): MessageStreamItem {
  return assistantResponseMessageStreamItemFromData(agentMessageStreamTextDataFromItem(item), turnId);
}

function agentMessageStreamTextDataFromItem(item: AgentMessageItem): MessageStreamTextData {
  return { id: item.id, text: item.text };
}

function assistantResponseMessageStreamItemFromData(data: MessageStreamTextData, turnId?: string): MessageStreamItem {
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

function proposedPlanMessageStreamItem(item: PlanItem, turnId?: string): MessageStreamItem {
  return proposedPlanMessageStreamItemFromData(proposedPlanMessageStreamItemDataFromItem(item), turnId);
}

function proposedPlanMessageStreamItemDataFromItem(item: PlanItem): MessageStreamTextData {
  const text = normalizeProposedPlanMarkdown(item.text);
  return { id: item.id, text };
}

function proposedPlanMessageStreamItemFromData(data: MessageStreamTextData, turnId?: string): MessageStreamItem {
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

function hookPromptMessageStreamItem(item: HookPromptItem, turnId?: string): MessageStreamItem {
  return hookPromptMessageStreamItemFromData(hookPromptMessageStreamItemDataFromItem(item), turnId);
}

function hookPromptMessageStreamItemDataFromItem(item: HookPromptItem): MessageStreamTextData {
  return { id: item.id, text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt" };
}

function hookPromptMessageStreamItemFromData(data: MessageStreamTextData, turnId?: string): MessageStreamItem {
  return {
    id: data.id,
    kind: "hook",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
  };
}

function reasoningMessageStreamItem(item: ReasoningItem, turnId?: string): MessageStreamItem {
  return reasoningMessageStreamItemFromData(reasoningMessageStreamItemDataFromItem(item), turnId);
}

function reasoningMessageStreamItemDataFromItem(item: ReasoningItem): MessageStreamTextData {
  return { id: item.id, text: reasoningText(item) };
}

function reasoningMessageStreamItemFromData(data: MessageStreamTextData, turnId?: string): MessageStreamItem {
  return {
    id: data.id,
    kind: "reasoning",
    role: "tool",
    text: data.text,
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
  };
}

function mcpToolCallMessageStreamItem(item: McpToolCallItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(mcpToolCallMessageStreamItemDataFromItem(item), turnId);
}

function mcpToolCallMessageStreamItemDataFromItem(item: McpToolCallItem): ToolMessageStreamData {
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

function toolMessageStreamItemFromData(data: ToolMessageStreamData, turnId?: string): MessageStreamItem {
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

function dynamicToolCallMessageStreamItem(item: DynamicToolCallItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(dynamicToolCallMessageStreamItemDataFromItem(item), turnId);
}

function dynamicToolCallMessageStreamItemDataFromItem(item: DynamicToolCallItem): ToolMessageStreamData {
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

function webSearchMessageStreamItem(item: WebSearchItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(webSearchMessageStreamItemDataFromItem(item), turnId);
}

function webSearchMessageStreamItemDataFromItem(item: WebSearchItem): ToolMessageStreamData {
  return {
    id: item.id,
    text: webSearchSummary(item),
    toolLabel: "web search",
    details: webSearchDetails(item),
    output: "",
  };
}

function imageViewMessageStreamItem(item: ImageViewItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(imageViewMessageStreamItemDataFromItem(item), turnId);
}

function imageViewMessageStreamItemDataFromItem(item: ImageViewItem): ToolMessageStreamData {
  return {
    id: item.id,
    text: compactToolSummary(null, item.path),
    toolLabel: "imageView",
    summaryPath: true,
  };
}

function imageGenerationMessageStreamItem(item: ImageGenerationItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(imageGenerationMessageStreamItemDataFromItem(item), turnId);
}

function imageGenerationMessageStreamItemDataFromItem(item: ImageGenerationItem): ToolMessageStreamData {
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

function reviewModeMessageStreamItem(item: ReviewModeItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(reviewModeMessageStreamItemDataFromItem(item), turnId);
}

function reviewModeMessageStreamItemDataFromItem(item: ReviewModeItem): ToolMessageStreamData {
  return {
    id: item.id,
    text: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode",
    toolLabel: item.type,
    output: item.review,
  };
}

function contextCompactionMessageStreamItem(item: ContextCompactionItem, turnId?: string): MessageStreamItem {
  return contextCompactionMessageStreamItemFromData(contextCompactionMessageStreamItemDataFromItem(item), turnId);
}

function contextCompactionMessageStreamItemDataFromItem(item: ContextCompactionItem): MessageStreamTextData {
  return { id: item.id, text: "Context compaction" };
}

function contextCompactionMessageStreamItemFromData(data: MessageStreamTextData, turnId?: string): MessageStreamItem {
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

function fileChangeTargetLabel(changes: MessageStreamFileChange[]): string {
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

function webSearchDetails(item: WebSearchItem): MessageStreamDetailSection[] {
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

function commandMessageStreamItem(item: CommandExecutionItem, turnId?: string): MessageStreamItem {
  return commandMessageStreamItemFromData(commandMessageStreamItemDataFromItem(item), turnId);
}

function commandMessageStreamItemDataFromItem(item: CommandExecutionItem): CommandMessageStreamData {
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

function commandMessageStreamItemFromData(data: CommandMessageStreamData, turnId?: string): MessageStreamItem {
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

function fileChangeMessageStreamItem(item: FileChangeItem, turnId?: string): MessageStreamItem {
  return fileChangeMessageStreamItemFromData(fileChangeMessageStreamItemDataFromItem(item), turnId);
}

function fileChangeMessageStreamItemDataFromItem(item: FileChangeItem): FileChangeMessageStreamData {
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

function fileChangeMessageStreamItemFromData(data: FileChangeMessageStreamData, turnId?: string): MessageStreamItem {
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

export function normalizeFileChanges(changes: FileUpdateChange[]): MessageStreamFileChange[] {
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
