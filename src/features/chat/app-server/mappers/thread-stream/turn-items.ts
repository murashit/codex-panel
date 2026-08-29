import {
  completedTurnTranscriptSummaryFromTurnRecord,
  type TurnItem,
  type TurnRecord,
  turnUserItemProjection,
} from "../../../../../app-server/protocol/turn";
import { jsonPreview } from "../../../../../domain/display/json-preview";
import type { HistoricalTurn } from "../../../../../domain/threads/history";
import type { TurnTranscriptSummary } from "../../../../../domain/threads/transcript";
import { contextAttachmentsFromHistoryContexts } from "../../../domain/thread-stream/format/context-attachments";
import { threadStreamFileReferences } from "../../../domain/thread-stream/format/file-references";
import { normalizeProposedPlanMarkdown } from "../../../domain/thread-stream/format/proposed-plan";
import { userMessageDisplayText } from "../../../domain/thread-stream/format/user-message-text";
import type { CommandThreadStreamTarget, ThreadStreamDiagnosticSection, ThreadStreamItem } from "../../../domain/thread-stream/items";
import type { ThreadStreamItemProvenance } from "../../../domain/thread-stream/provenance";
import { agentThreadStreamItem, subagentActivityThreadStreamItem } from "./agent-items";
import {
  appServerFailedStatusLabel,
  commandExecutionState,
  dynamicToolCallExecutionState,
  imageGenerationExecutionState,
  mcpToolCallExecutionState,
  patchApplyExecutionState,
} from "./execution-state";
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

export type AppServerTurnItem = TurnItem;

export function completedTurnTranscriptSummaryFromAppServerTurn(turn: TurnRecord): TurnTranscriptSummary | null {
  return completedTurnTranscriptSummaryFromTurnRecord(turn);
}

export function threadStreamItemsFromTurns(turns: readonly HistoricalTurn[]): ThreadStreamItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: ThreadStreamItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items as readonly TurnItem[]) {
      const streamItem = threadStreamItemFromTurnItem(item, turn.id);
      if (streamItem) items.push(streamItem);
    }
  }
  return items;
}

export function threadStreamItemFromTurnItem(item: TurnItem, turnId?: string): ThreadStreamItem | null {
  const streamItem = threadStreamItemFromTurnItemCore(item, turnId);
  return streamItem ? withTurnItemProvenance(streamItem, item) : null;
}

function threadStreamItemFromTurnItemCore(item: TurnItem, turnId?: string): ThreadStreamItem | null {
  switch (item.type) {
    case "userMessage":
      return userThreadStreamItem(item, turnId);
    case "agentMessage":
      return assistantThreadStreamItemFromTurn(item, turnId);
    case "commandExecution":
      return commandThreadStreamItem(item, turnId);
    case "fileChange":
      return fileChangeThreadStreamItem(item, turnId);
    case "plan":
      return proposedPlanThreadStreamItem(item, turnId);
    case "hookPrompt":
      return hookPromptThreadStreamItem(item, turnId);
    case "reasoning":
      return reasoningThreadStreamItem(item, turnId);
    case "mcpToolCall":
      return mcpToolCallThreadStreamItem(item, turnId);
    case "dynamicToolCall":
      return dynamicToolCallThreadStreamItem(item, turnId);
    case "collabAgentToolCall":
      return agentThreadStreamItem(item, turnId);
    case "webSearch":
      return webSearchThreadStreamItem(item, turnId);
    case "imageView":
      return imageViewThreadStreamItem(item, turnId);
    case "sleep":
      return sleepThreadStreamItem(item, turnId);
    case "imageGeneration":
      return imageGenerationThreadStreamItem(item, turnId);
    case "subAgentActivity":
      return subagentActivityThreadStreamItem(item, turnId);
    case "enteredReviewMode":
    case "exitedReviewMode":
      return reviewModeThreadStreamItem(item, turnId);
    case "contextCompaction":
      return contextCompactionThreadStreamItem(item, turnId);
    case "functionCallOutput":
      return null;
    default:
      return ignoredUnsupportedTurnItem(item);
  }
}

function withTurnItemProvenance(item: ThreadStreamItem, turnItem: TurnItem): ThreadStreamItem {
  const provenance: ThreadStreamItemProvenance = {
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

function userThreadStreamItem(item: UserMessageItem, turnId?: string): ThreadStreamItem {
  const projection = turnUserItemProjection(item);
  const text = projection.text;
  const referencedThread = projection.referencedThread;
  const referencedFiles = threadStreamFileReferences(projection.fileReferences);
  const contextAttachments = contextAttachmentsFromHistoryContexts(projection.contexts, text);
  if (referencedThread) {
    return {
      ...turnItemSourceFields(item, turnId),
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: userMessageDisplayText(text, item.content),
      copyText: text,
      referencedThread,
      ...definedProp("clientId", item.clientId),
      ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
      ...(contextAttachments.length > 0 ? { contextAttachments } : {}),
    };
  }
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text: userMessageDisplayText(text, item.content),
    copyText: text,
    ...definedProp("clientId", item.clientId),
    ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
    ...(contextAttachments.length > 0 ? { contextAttachments } : {}),
  };
}

function assistantThreadStreamItemFromTurn(item: AgentMessageItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text: item.text,
    copyText: item.text,
    dialogueState: "completed",
  };
}

function proposedPlanThreadStreamItem(item: PlanItem, turnId?: string): ThreadStreamItem {
  const text = normalizeProposedPlanMarkdown(item.text);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "dialogue",
    dialogueKind: "proposedPlan",
    role: "assistant",
    text,
    copyText: text,
    dialogueState: "completed",
  };
}

function hookPromptThreadStreamItem(item: HookPromptItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "hook",
    role: "tool",
    text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt",
  };
}

function reasoningThreadStreamItem(item: ReasoningItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "reasoning",
    role: "tool",
    text: reasoningText(item),
  };
}

function mcpToolCallThreadStreamItem(item: McpToolCallItem, turnId?: string): ThreadStreamItem {
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

function dynamicToolCallThreadStreamItem(item: DynamicToolCallItem, turnId?: string): ThreadStreamItem {
  const qualifiedName = `${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
  const failure = item.success === false ? "failed" : appServerFailedStatusLabel(item.status);
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: "dynamic tool",
    primaryTarget: { kind: "value", value: qualifiedName },
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

function webSearchThreadStreamItem(item: WebSearchItem, turnId?: string): ThreadStreamItem {
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

function imageViewThreadStreamItem(item: ImageViewItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: "imageView",
    primaryTarget: { kind: "path", path: item.path },
  };
}

function sleepThreadStreamItem(item: SleepItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "wait",
    role: "tool",
    text: `Waited ${durationLabel(item.durationMs)}`,
    executionState: "completed",
  };
}

function imageGenerationThreadStreamItem(item: ImageGenerationItem, turnId?: string): ThreadStreamItem {
  const target = item.savedPath ?? item.result;
  const failureReason = appServerFailedStatusLabel(item.status);
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

function reviewModeThreadStreamItem(item: ReviewModeItem, turnId?: string): ThreadStreamItem {
  return {
    ...turnItemSourceFields(item, turnId),
    kind: "tool",
    role: "tool",
    toolName: item.type,
    primaryTarget: { kind: "value", value: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode" },
    output: item.review,
  };
}

function contextCompactionThreadStreamItem(item: ContextCompactionItem, turnId?: string): ThreadStreamItem {
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

function commandTarget(item: CommandExecutionItem): CommandThreadStreamTarget {
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

function webSearchDetails(item: WebSearchItem): Extract<ThreadStreamItem, { kind: "tool" }>["webSearch"] {
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

function commandThreadStreamItem(item: CommandExecutionItem, turnId?: string): ThreadStreamItem {
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

function fileChangeThreadStreamItem(item: FileChangeItem, turnId?: string): ThreadStreamItem {
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

function ignoredUnsupportedTurnItem(item: never): null {
  void item;
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
): readonly ThreadStreamDiagnosticSection[] | undefined {
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

function definedProp<Key extends string, Value>(key: Key, value: Value | null | undefined): Record<Key, Value> | Record<string, never> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
