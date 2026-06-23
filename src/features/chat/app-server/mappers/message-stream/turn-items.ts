import type { CommandMessageStreamTarget, MessageStreamDiagnosticSection, MessageStreamItem } from "../../../domain/message-stream/items";
import type { MessageStreamItemProvenance } from "../../../domain/message-stream/provenance";
import type { HistoricalTurn } from "../../../../../domain/threads/history";
import type { TurnItem } from "../../../../../app-server/protocol/turn";
import { definedProp } from "../../../../../shared/object/defined-prop";
import { jsonPreview } from "../../../../../shared/text/preview";
import { referencedThreadMetadataFromPrompt } from "../../../../../domain/threads/reference";
import { turnUserItemText } from "../../../../../app-server/protocol/turn";
import { agentMessageStreamItem } from "./agent-items";
import { fileMentionsFromInput } from "../../../domain/message-stream/format/file-mentions";
import { normalizeProposedPlanMarkdown } from "../../../domain/message-stream/format/proposed-plan";
import { userMessageDisplayText } from "../../../domain/message-stream/format/user-message-text";
import {
  commandExecutionState,
  dynamicToolCallExecutionState,
  failedStatusLabel,
  imageGenerationExecutionState,
  mcpToolCallExecutionState,
  patchApplyExecutionState,
} from "../../../domain/message-stream/execution-state";
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
type SleepItem = Extract<TurnItem, { type: "sleep" }>;
type ImageGenerationItem = Extract<TurnItem, { type: "imageGeneration" }>;
type ReviewModeItem = Extract<TurnItem, { type: "enteredReviewMode" }> | Extract<TurnItem, { type: "exitedReviewMode" }>;
type ContextCompactionItem = Extract<TurnItem, { type: "contextCompaction" }>;
interface TurnItemSourceFields {
  id: string;
  turnId?: string;
  sourceItemId: string;
}

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
  const streamItem = messageStreamItemFromTurnItemCore(item, turnId);
  return streamItem ? withTurnItemProvenance(streamItem, item) : null;
}

function messageStreamItemFromTurnItemCore(item: TurnItem, turnId?: string): MessageStreamItem | null {
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
    case "sleep":
      return sleepMessageStreamItem(item, turnId);
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

function turnItemSourceFields(item: { id: string }, turnId?: string): TurnItemSourceFields {
  return {
    id: item.id,
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
  };
}

function userMessageStreamItem(item: UserMessageItem, turnId?: string): MessageStreamItem {
  const text = turnUserItemText(item);
  const referencedThread = referencedThreadMetadataFromPrompt(text);
  const mentionedFiles = fileMentionsFromInput(item.content);
  if (referencedThread) {
    return {
      ...turnItemSourceFields(item, turnId),
      kind: "message",
      messageKind: "user",
      role: "user",
      text: userMessageDisplayText(referencedThread.text, item.content),
      copyText: referencedThread.text,
      referencedThread: referencedThread.reference,
      ...definedProp("clientId", item.clientId),
      ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
    };
  }
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "message",
    messageKind: "user",
    role: "user",
    text: userMessageDisplayText(text, item.content),
    copyText: text,
    ...definedProp("clientId", item.clientId),
    ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
  };
}

function assistantMessageStreamItemFromTurn(item: AgentMessageItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "message",
    messageKind: "assistantResponse",
    role: "assistant",
    text: item.text,
    copyText: item.text,
    messageState: "completed",
  };
}

function proposedPlanMessageStreamItem(item: PlanItem, turnId?: string): MessageStreamItem {
  const text = normalizeProposedPlanMarkdown(item.text);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "message",
    messageKind: "proposedPlan",
    role: "assistant",
    text,
    copyText: text,
    messageState: "completed",
  };
}

function hookPromptMessageStreamItem(item: HookPromptItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "hook",
    role: "tool",
    text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt",
  };
}

function reasoningMessageStreamItem(item: ReasoningItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "reasoning",
    role: "tool",
    text: reasoningText(item),
  };
}

function mcpToolCallMessageStreamItem(item: McpToolCallItem, turnId?: string): MessageStreamItem {
  const name = `${item.server}.${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: name,
    ...(target ? { primaryTarget: { kind: "value" as const, value: target } } : {}),
    ...(item.error?.message ? { failureReason: item.error.message } : {}),
    status: item.status,
    ...definedProp(
      "diagnostics",
      jsonDiagnosticSections(
        { title: "Arguments JSON", value: item.arguments },
        { title: "Result JSON", value: item.result },
        { title: "Error JSON", value: item.error },
      ),
    ),
    output: "",
    executionState: mcpToolCallExecutionState(item.status),
  };
}

function dynamicToolCallMessageStreamItem(item: DynamicToolCallItem, turnId?: string): MessageStreamItem {
  const name = `${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
  const target = jsonTargetLabel(item.arguments);
  const failure = item.success === false ? "failed" : failedStatusLabel(item.status);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: name,
    ...(target ? { primaryTarget: { kind: "value" as const, value: target } } : {}),
    ...(failure ? { failureReason: failure } : {}),
    status: item.status,
    ...definedProp(
      "diagnostics",
      jsonDiagnosticSections({ title: "Arguments JSON", value: item.arguments }, { title: "Result JSON", value: item.contentItems }),
    ),
    output: "",
    executionState: dynamicToolCallExecutionState(item.status, item.success),
  };
}

function webSearchMessageStreamItem(item: WebSearchItem, turnId?: string): MessageStreamItem {
  const target = webSearchTarget(item);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: "web search",
    operation: item.action?.type ?? (item.query ? "search" : "webSearch"),
    ...(target ? { primaryTarget: { kind: "value" as const, value: target } } : {}),
    ...definedProp("webSearch", webSearchDetails(item)),
    output: "",
  };
}

function imageViewMessageStreamItem(item: ImageViewItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: "imageView",
    primaryTarget: { kind: "path", path: item.path },
  };
}

function sleepMessageStreamItem(item: SleepItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "wait",
    role: "tool",
    text: `Waited ${durationLabel(item.durationMs)}`,
    executionState: "completed",
  };
}

function imageGenerationMessageStreamItem(item: ImageGenerationItem, turnId?: string): MessageStreamItem {
  const target = item.savedPath ?? item.result;
  const failureReason = failedStatusLabel(item.status);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
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
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: item.type,
    primaryTarget: { kind: "value", value: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode" },
    output: item.review,
  };
}

function contextCompactionMessageStreamItem(item: ContextCompactionItem, turnId?: string): MessageStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "contextCompaction",
    role: "tool",
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
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "command",
    role: "tool",
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

function fileChangeMessageStreamItem(item: FileChangeItem, turnId?: string): MessageStreamItem {
  const changes = normalizeFileChanges(item.changes);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "fileChange",
    role: "tool",
    status: item.status,
    changes,
    executionState: patchApplyExecutionState(item.status),
  };
}

export function shouldSuppressLifecycleItem(item: TurnItem): boolean {
  return item.type === "agentMessage" || item.type === "userMessage";
}

function ignoredUnsupportedTurnItem(_item: never): null {
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

function jsonDiagnosticSections(
  ...sections: readonly { readonly title: string; readonly value: unknown }[]
): readonly MessageStreamDiagnosticSection[] | undefined {
  const diagnostics = sections
    .filter((section) => section.value !== null && section.value !== undefined)
    .map((section) => ({ title: section.title, body: jsonPreview(section.value) }));
  return diagnostics.length > 0 ? diagnostics : undefined;
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

function durationLabel(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)}ms`;
  if (durationMs % 1000 === 0) return `${String(durationMs / 1000)}s`;
  return `${String(durationMs / 1000)}s`;
}
