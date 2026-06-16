import type {
  CommandMessageStreamTarget,
  ExecutionState,
  MessageStreamFileChange,
  MessageStreamFileMention,
  MessageStreamItem,
  MessageStreamPrimaryTarget,
} from "../../../domain/message-stream/items";
import type { MessageStreamItemProvenance } from "../../../domain/message-stream/provenance";
import type { HistoricalTurn } from "../../../../../domain/threads/history";
import type { TurnItem } from "../../../../../app-server/protocol/turn";
import { definedProp } from "../../../../../utils";
import { referencedThreadMetadataFromPrompt, type ReferencedThreadMetadata } from "../../../../../domain/threads/reference";
import { turnUserItemText } from "../../../../../app-server/protocol/turn";
import { agentMessageStreamItem } from "./agent-items";
import { fileMentionsFromInput } from "../../../domain/message-stream/format/file-mentions";
import { normalizeProposedPlanMarkdown } from "../../../domain/message-stream/format/proposed-plan";
import { userMessageDisplayText } from "../../../domain/message-stream/format/user-message-text";
import { normalizeFileChanges } from "./file-changes";

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
  text?: string;
  toolName?: string;
  primaryTarget?: MessageStreamPrimaryTarget;
  operation?: string;
  failureReason?: string;
  status?: string;
  output?: string;
  toolCall?: Extract<MessageStreamItem, { kind: "tool" }>["toolCall"];
  webSearch?: Extract<MessageStreamItem, { kind: "tool" }>["webSearch"];
  imageGeneration?: Extract<MessageStreamItem, { kind: "tool" }>["imageGeneration"];
  executionState?: ExecutionState;
}

interface CommandMessageStreamData extends BaseStreamItemData {
  commandAction: "read" | "search" | "listFiles" | "command";
  commandTarget: CommandMessageStreamTarget;
  command: string;
  cwd: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  output: string;
  executionState: ExecutionState;
}

interface FileChangeMessageStreamData extends BaseStreamItemData {
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

export function messageStreamItemsFromTurns(turns: readonly HistoricalTurn[]): MessageStreamItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: MessageStreamItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items as readonly TurnItem[]) {
      const streamItem = messageStreamItemFromTurnItem(item, turn.id);
      if (streamItem) items.push(streamItem);
    }
  }
  return items;
}

export function messageStreamItemFromTurnItem(item: TurnItem, turnId?: string): MessageStreamItem | null {
  const streamItem = messageStreamItemFromTurnItemData(item, turnId);
  return streamItem ? withTurnItemProvenance(streamItem, item) : null;
}

function messageStreamItemFromTurnItemData(item: TurnItem, turnId?: string): MessageStreamItem | null {
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
    case "subAgentActivity":
      return null;
    case "enteredReviewMode":
    case "exitedReviewMode":
      return reviewModeMessageStreamItem(item, turnId);
    case "contextCompaction":
      return contextCompactionMessageStreamItem(item, turnId);
    default:
      return ignoredUnsupportedTurnItem(item);
  }
}

function withTurnItemProvenance(item: MessageStreamItem, turnItem: TurnItem): MessageStreamItem {
  const provenance: MessageStreamItemProvenance = {
    source: "appServer",
    channel: "turnItem",
    itemType: turnItem.type,
    itemId: turnItem.id,
  };
  return { ...item, provenance };
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
  return {
    id: item.id,
    toolName: name,
    ...(target ? { primaryTarget: { kind: "value" as const, value: target } } : {}),
    ...(item.error?.message ? { failureReason: item.error.message } : {}),
    status: item.status,
    toolCall: {
      arguments: item.arguments,
      result: item.result,
      error: item.error,
    },
    output: "",
    executionState: mcpToolCallExecutionState(item.status),
  };
}

function toolMessageStreamItemFromData(data: ToolMessageStreamData, turnId?: string): MessageStreamItem {
  return {
    id: data.id,
    kind: "tool",
    role: "tool",
    ...definedProp("text", data.text),
    ...definedProp("toolName", data.toolName),
    ...definedProp("primaryTarget", data.primaryTarget),
    ...definedProp("operation", data.operation),
    ...definedProp("failureReason", data.failureReason),
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    ...definedProp("status", data.status),
    ...definedProp("toolCall", data.toolCall),
    ...definedProp("webSearch", data.webSearch),
    ...definedProp("imageGeneration", data.imageGeneration),
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
    toolName: name,
    ...(target ? { primaryTarget: { kind: "value" as const, value: target } } : {}),
    ...(failure ? { failureReason: failure } : {}),
    status: item.status,
    toolCall: {
      arguments: item.arguments,
      result: item.contentItems,
    },
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
    toolName: "web search",
    operation: item.action?.type ?? (item.query ? "search" : "webSearch"),
    ...(webSearchTarget(item) ? { primaryTarget: { kind: "value" as const, value: webSearchTarget(item) ?? "" } } : {}),
    webSearch: webSearchDetails(item),
    output: "",
  };
}

function imageViewMessageStreamItem(item: ImageViewItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(imageViewMessageStreamItemDataFromItem(item), turnId);
}

function imageViewMessageStreamItemDataFromItem(item: ImageViewItem): ToolMessageStreamData {
  return {
    id: item.id,
    toolName: "imageView",
    primaryTarget: { kind: "path", path: item.path },
  };
}

function imageGenerationMessageStreamItem(item: ImageGenerationItem, turnId?: string): MessageStreamItem {
  return toolMessageStreamItemFromData(imageGenerationMessageStreamItemDataFromItem(item), turnId);
}

function imageGenerationMessageStreamItemDataFromItem(item: ImageGenerationItem): ToolMessageStreamData {
  const target = item.savedPath ?? item.result;
  const failureReason = failedStatusLabel(item.status);
  return {
    id: item.id,
    toolName: "imageGeneration",
    ...(target
      ? { primaryTarget: item.savedPath ? { kind: "path" as const, path: item.savedPath } : { kind: "value" as const, value: target } }
      : {}),
    ...(failureReason ? { failureReason } : {}),
    status: item.status,
    imageGeneration: {
      ...definedProp("savedPath", item.savedPath),
      revisedPrompt: item.revisedPrompt,
      result: item.result,
    },
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
    toolName: item.type,
    primaryTarget: { kind: "value", value: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode" },
    output: item.review,
  };
}

function contextCompactionMessageStreamItem(item: ContextCompactionItem, turnId?: string): MessageStreamItem {
  return contextCompactionMessageStreamItemFromData(contextCompactionMessageStreamItemDataFromItem(item), turnId);
}

function contextCompactionMessageStreamItemDataFromItem(item: ContextCompactionItem): BaseStreamItemData {
  return { id: item.id };
}

function contextCompactionMessageStreamItemFromData(data: BaseStreamItemData, turnId?: string): MessageStreamItem {
  return {
    id: data.id,
    kind: "contextCompaction",
    role: "tool",
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

function commandTarget(item: CommandExecutionItem): CommandMessageStreamTarget {
  const action = representativeCommandAction(item.commandActions);
  if (action?.type === "search") {
    const query = commandActionValue(action.query) ?? undefined;
    const path = commandActionValue(action.path) ?? undefined;
    return { kind: "search", ...(query ? { query } : {}), ...(path ? { path } : {}) };
  }
  if (action?.type === "read") {
    const path = commandActionValue(action.path) ?? undefined;
    return { kind: "read", name: action.name, ...(path ? { path } : {}) };
  }
  if (action?.type === "listFiles") {
    const path = commandActionValue(action.path) ?? undefined;
    return { kind: "listFiles", ...(path ? { path } : {}) };
  }
  return { kind: "command", commandLine: unwrapShellLoginCommand(firstCommandLine(item.command)) };
}

function commandActionKind(item: CommandExecutionItem): "read" | "search" | "listFiles" | "command" {
  const action = representativeCommandAction(item.commandActions);
  if (action?.type === "read") return "read";
  if (action?.type === "search") return "search";
  if (action?.type === "listFiles") return "listFiles";
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

function webSearchTarget(item: WebSearchItem): string | null {
  if (item.action?.type === "openPage") return item.action.url;
  if (item.action?.type === "findInPage") return item.action.pattern ?? item.action.url;
  if (item.action?.type === "search") return webSearchQueryList(item.action.query, item.action.queries, item.query);
  return item.query;
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

function webSearchDetails(item: WebSearchItem): Extract<MessageStreamItem, { kind: "tool" }>["webSearch"] {
  const details: {
    action?: string;
    query?: string;
    url?: string;
    pattern?: string;
  } = {};
  if (item.action) details.action = webSearchActionLabel(item.action.type);
  if (item.action?.type === "search") {
    const queries = webSearchQueryList(item.action.query, item.action.queries, item.query);
    if (queries) details.query = queries;
  } else if (item.action?.type === "openPage") {
    if (item.action.url) details.url = item.action.url;
  } else if (item.action?.type === "findInPage") {
    if (item.action.pattern) details.pattern = item.action.pattern;
    if (item.action.url) details.url = item.action.url;
  } else if (item.query) {
    details.query = item.query;
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function commandMessageStreamItem(item: CommandExecutionItem, turnId?: string): MessageStreamItem {
  return commandMessageStreamItemFromData(commandMessageStreamItemDataFromItem(item), turnId);
}

function commandMessageStreamItemDataFromItem(item: CommandExecutionItem): CommandMessageStreamData {
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
  return {
    id: item.id,
    commandAction: commandActionKind(item),
    commandTarget: commandTarget(item),
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
    commandAction: data.commandAction,
    commandTarget: data.commandTarget,
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
  return {
    id: item.id,
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
    ...definedProp("turnId", turnId),
    sourceItemId: data.id,
    status: data.status,
    changes: data.changes,
    executionState: data.executionState,
  };
}

export function shouldSuppressLifecycleItem(item: TurnItem): boolean {
  return item.type === "agentMessage" || item.type === "userMessage";
}

function ignoredUnsupportedTurnItem(_item: never): null {
  return null;
}

function commandExecutionState(status: string, exitCode?: number): ExecutionState {
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  const state = executionStateFromStatus(status, COMMAND_STATES);
  if (state) return state;
  if (typeof exitCode === "number") return "completed";
  return null;
}

function patchApplyExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, PATCH_STATES);
}

function mcpToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

function dynamicToolCallExecutionState(status: string, success?: boolean | null): ExecutionState {
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

function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function jsonTargetLabel(value: unknown): string | null {
  const direct = jsonTargetPrimitive(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const priorityKeys = [
    "q",
    "query",
    "search_query",
    "url",
    "ref_id",
    "path",
    "file",
    "filename",
    "ticker",
    "location",
    "team",
    "league",
    "id",
    "target",
    "command",
  ];

  for (const key of priorityKeys) {
    const target = jsonTargetPrimitive(record[key]);
    if (target) return target;
  }

  const firstEntry = Object.entries(record).find(([, entryValue]) => jsonTargetPrimitive(entryValue));
  return firstEntry ? jsonTargetPrimitive(firstEntry[1]) : null;
}

function jsonTargetPrimitive(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const target = jsonTargetLabel(item);
    if (target) return target;
  }
  return null;
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
