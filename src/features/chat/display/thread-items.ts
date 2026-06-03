import type { DisplayDetailSection, DisplayFileChange, DisplayFileMention, DisplayItem } from "./types";
import type { FileUpdateChange } from "../../../generated/app-server/v2/FileUpdateChange";
import type { ThreadItem } from "../../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../../generated/app-server/v2/Turn";
import type { UserInput } from "../../../generated/app-server/v2/UserInput";
import { definedProp, truncate } from "../../../utils";
import { referencedThreadDisplayFromPrompt } from "../../../domain/threads/reference";
import { userItemText } from "../../../domain/threads/transcript";
import { agentDisplayItem } from "./agent";
import { pathRelativeToRoot } from "./paths";
import { normalizeProposedPlanMarkdown } from "./plan";
import {
  commandExecutionState,
  dynamicToolCallExecutionState,
  imageGenerationExecutionState,
  mcpToolCallExecutionState,
  patchApplyExecutionState,
} from "./state";
import {
  bodyDetail,
  compactToolSummary,
  failedStatusLabel,
  jsonDetails,
  jsonTargetLabel,
  metaDetail,
  statusQualifier,
} from "./tool-format";

type UserMessageItem = Extract<ThreadItem, { type: "userMessage" }>;
type AgentMessageItem = Extract<ThreadItem, { type: "agentMessage" }>;
type PlanItem = Extract<ThreadItem, { type: "plan" }>;
type HookPromptItem = Extract<ThreadItem, { type: "hookPrompt" }>;
type ReasoningItem = Extract<ThreadItem, { type: "reasoning" }>;
type CommandExecutionItem = Extract<ThreadItem, { type: "commandExecution" }>;
type CommandAction = CommandExecutionItem["commandActions"][number];
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;
type McpToolCallItem = Extract<ThreadItem, { type: "mcpToolCall" }>;
type DynamicToolCallItem = Extract<ThreadItem, { type: "dynamicToolCall" }>;
type WebSearchItem = Extract<ThreadItem, { type: "webSearch" }>;
type ImageViewItem = Extract<ThreadItem, { type: "imageView" }>;
type ImageGenerationItem = Extract<ThreadItem, { type: "imageGeneration" }>;
type ReviewModeItem = Extract<ThreadItem, { type: "enteredReviewMode" }> | Extract<ThreadItem, { type: "exitedReviewMode" }>;
type ContextCompactionItem = Extract<ThreadItem, { type: "contextCompaction" }>;
type TextRange = [number, number];

export function displayItemsFromTurns(turns: readonly Turn[]): DisplayItem[] {
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

export function displayItemFromThreadItem(item: ThreadItem, turnId?: string): DisplayItem | null {
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
  const text = userItemText(item);
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
      itemId: item.id,
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
    itemId: item.id,
    ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
  };
}

export function fileMentionsFromInput(input: UserInput[]): DisplayFileMention[] {
  const seen = new Set<string>();
  const mentions: DisplayFileMention[] = [];
  for (const item of input) {
    if (item.type !== "mention" || seen.has(item.path)) continue;
    seen.add(item.path);
    mentions.push({ name: item.name, path: item.path });
  }
  return mentions;
}

export function userMessageDisplayText(text: string, input: readonly UserInput[]): string {
  const names = resolvedSkillNames(input);
  if (names.length === 0) return text;

  const pattern = new RegExp(`(^|[\\s([{])\\$(${names.map(escapeRegExp).join("|")})(?=$|[\\s\\])}.,;!?])`, "gi");
  const codeRanges = markdownCodeRanges(text);
  return text.replace(pattern, (match: string, prefix: string, name: string, offset: number) => {
    const dollarIndex = offset + prefix.length;
    return isIndexInRanges(dollarIndex, codeRanges) ? match : `${prefix}${markdownCodeSpan(`$${name}`)}`;
  });
}

function resolvedSkillNames(input: readonly UserInput[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input) {
    if (item.type !== "skill") continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(item.name);
  }
  return names.sort((a, b) => b.length - a.length);
}

function markdownCodeSpan(text: string): string {
  if (!text.includes("`")) return `\`${text}\``;
  const longestRun = Math.max(...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  return `${delimiter} ${text} ${delimiter}`;
}

function markdownCodeRanges(text: string): TextRange[] {
  return [...markdownFenceRanges(text), ...markdownInlineCodeRanges(text)].sort((a, b) => a[0] - b[0]);
}

function markdownFenceRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let active: { marker: string; start: number } | null = null;
  let offset = 0;
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const value = line[0];
    if (value.length === 0) break;
    const fence = /^(?: {0,3})(`{3,}|~{3,})/.exec(value);
    if (fence) {
      const marker = fence[1];
      if (!marker) continue;
      if (!active) {
        active = { marker, start: offset };
      } else if (marker.startsWith(active.marker.charAt(0)) && marker.length >= active.marker.length) {
        ranges.push([active.start, offset + value.length]);
        active = null;
      }
    }
    offset += value.length;
  }
  if (active) ranges.push([active.start, text.length]);
  return ranges;
}

function markdownInlineCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fenceRanges = markdownFenceRanges(text);
  let index = 0;
  while (index < text.length) {
    if (isIndexInRanges(index, fenceRanges) || text[index] !== "`") {
      index += 1;
      continue;
    }
    const match = /`+/.exec(text.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    const delimiter = match[0];
    const end = text.indexOf(delimiter, index + delimiter.length);
    if (end < 0) {
      index += delimiter.length;
      continue;
    }
    ranges.push([index, end + delimiter.length]);
    index = end + delimiter.length;
  }
  return ranges;
}

function isIndexInRanges(index: number, ranges: readonly TextRange[]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
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
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
  };
}

function reasoningDisplayItem(item: ReasoningItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "reasoning",
    role: "tool",
    text: reasoningText(item),
    ...definedProp("turnId", turnId),
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
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
    itemId: item.id,
    output: item.review,
  };
}

function contextCompactionDisplayItem(item: ContextCompactionItem, turnId?: string): DisplayItem {
  return {
    id: item.id,
    kind: "tool",
    role: "tool",
    text: "Context compaction",
    toolLabel: "contextCompaction",
    ...definedProp("turnId", turnId),
    itemId: item.id,
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

export function commandDisplayItem(item: CommandExecutionItem, turnId?: string): DisplayItem {
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
    itemId: item.id,
    command: item.command,
    cwd: item.cwd,
    status: item.status,
    ...definedProp("exitCode", exitCode),
    ...definedProp("durationMs", durationMs),
    output: item.aggregatedOutput ?? "",
    executionState: commandExecutionState(item.status, exitCode),
  };
}

export function fileChangeDisplayItem(item: FileChangeItem, turnId?: string): DisplayItem {
  const changes = normalizeFileChanges(item.changes);
  const qualifier = statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    kind: "fileChange",
    role: "tool",
    text: compactToolSummary(null, fileChangeTargetLabel(changes), qualifier),
    ...definedProp("turnId", turnId),
    itemId: item.id,
    status: item.status,
    changes,
    executionState: patchApplyExecutionState(item.status),
  };
}

export function normalizeFileChanges(changes: FileUpdateChange[]): DisplayFileChange[] {
  return changes.map((change) => ({
    kind: change.kind.type,
    path: change.path,
    diff: change.diff,
  }));
}

export function shouldSuppressLifecycleItem(item: ThreadItem): boolean {
  return item.type === "agentMessage" || item.type === "userMessage";
}

export function pathRelativeToWorkspace(path: string, workspaceRoot?: string | null): string {
  return pathRelativeToRoot(path, workspaceRoot);
}

function assertNever(_item: never): null {
  return null;
}
