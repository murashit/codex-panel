import type { DisplayDetailSection, DisplayFileChange, DisplayItem } from "./types";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { TurnPlanStep } from "../generated/app-server/v2/TurnPlanStep";
import { inputToText, truncate } from "../utils";
import { taskStatusMarker } from "./labels";
import { agentDisplayItem } from "./agent";
import { pathRelativeToRoot } from "./paths";
import { normalizeProposedPlanMarkdown } from "./plan";
import { classifyExecutionState } from "./state";
import {
  bodyDetail,
  compactToolSummary,
  failedStatusLabel,
  jsonDetails,
  jsonTargetLabel,
  metaDetail,
  statusQualifier,
} from "./tool-format";
export { activeAgentRunSummary, agentDisplayItem } from "./agent";
export { displayBlocksForItems } from "./blocks";
export { normalizeProposedPlanMarkdown } from "./plan";
export { classifyExecutionState, executionState, executionStateLabel } from "./state";
export { createAutoReviewResultItem, createReviewResultItem } from "./review";
export {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  completeReasoningItems,
  upsertDisplayItem,
} from "./stream-updates";

export function displayItemsFromTurns(turns: Turn[]): DisplayItem[] {
  const sortedTurns = [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const items: DisplayItem[] = [];
  for (const turn of sortedTurns) {
    for (const item of turn.items ?? []) {
      const displayItem = displayItemFromThreadItem(item, turn.id);
      if (displayItem) items.push(displayItem);
    }
  }
  return items;
}

export function displayItemFromThreadItem(item: ThreadItem, turnId?: string): DisplayItem | null {
  if (shouldSuppressThreadItem(item)) return null;

  if (item.type === "userMessage") {
    const text = inputToText(item.content);
    return {
      id: item.id,
      kind: "message",
      role: "user",
      text,
      copyText: text,
      turnId,
      itemId: item.id,
      markdown: true,
    };
  }

  if (item.type === "agentMessage") {
    return {
      id: item.id,
      kind: "message",
      role: "assistant",
      text: item.text,
      copyText: item.text,
      turnId,
      itemId: item.id,
      markdown: true,
    };
  }

  if (item.type === "commandExecution") {
    return commandDisplayItem(item, turnId);
  }

  if (item.type === "fileChange") {
    return fileChangeDisplayItem(item, turnId);
  }

  if (item.type === "plan") {
    const text = normalizeProposedPlanMarkdown(item.text);
    return {
      id: item.id,
      kind: "message",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      itemId: item.id,
      markdown: true,
    };
  }

  if (item.type === "hookPrompt") {
    return {
      id: item.id,
      kind: "hook",
      role: "tool",
      text: item.fragments.map((fragment) => fragment.text).join("\n\n") || "Hook prompt",
      turnId,
      itemId: item.id,
    };
  }

  if (item.type === "reasoning") {
    return {
      id: item.id,
      kind: "reasoning",
      role: "tool",
      text: reasoningText(item),
      turnId,
      itemId: item.id,
    };
  }

  if (item.type === "mcpToolCall") {
    const name = `${item.server}.${item.tool}`;
    const target = jsonTargetLabel(item.arguments);
    const failure = item.error?.message ? truncate(item.error.message, 96) : failedStatusLabel(item.status);
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
      toolLabel: name,
      turnId,
      itemId: item.id,
      status: item.status,
      details: jsonDetails([
        ["Arguments JSON", item.arguments],
        ["Result JSON", item.result],
        ["Error JSON", item.error],
      ]),
      output: "",
      state: classifyExecutionState({ status: item.status }),
    };
  }

  if (item.type === "dynamicToolCall") {
    const name = `${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
    const target = jsonTargetLabel(item.arguments);
    const failure = item.success === false ? "failed" : failedStatusLabel(item.status);
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: compactToolSummary(null, target, statusQualifier(item.status, failure)),
      toolLabel: name,
      turnId,
      itemId: item.id,
      status: item.status,
      details: jsonDetails([
        ["Arguments JSON", item.arguments],
        ["Result JSON", item.contentItems],
      ]),
      output: "",
      state: item.success === false ? "failed" : classifyExecutionState({ status: item.status }),
    };
  }

  if (item.type === "collabAgentToolCall") {
    return agentDisplayItem(item, turnId);
  }

  if (item.type === "webSearch") {
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: webSearchSummary(item),
      toolLabel: "web search",
      turnId,
      itemId: item.id,
      details: webSearchDetails(item),
      output: "",
    };
  }

  if (item.type === "imageView") {
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: compactToolSummary(null, item.path),
      toolLabel: "imageView",
      summaryPath: true,
      turnId,
      itemId: item.id,
    };
  }

  if (item.type === "imageGeneration") {
    const target = item.savedPath ?? item.result ?? item.revisedPrompt ?? null;
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: compactToolSummary(null, target, statusQualifier(item.status, failedStatusLabel(item.status))),
      toolLabel: "imageGeneration",
      summaryPath: Boolean(item.savedPath),
      turnId,
      itemId: item.id,
      status: item.status,
      details: [
        ...bodyDetail("Saved path", item.savedPath),
        ...bodyDetail("Revised prompt", item.revisedPrompt),
        ...bodyDetail("Result", item.result),
      ],
      output: "",
      state: classifyExecutionState({ status: item.status }),
    };
  }

  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode",
      toolLabel: item.type,
      turnId,
      itemId: item.id,
      output: item.review,
    };
  }

  if (item.type === "contextCompaction") {
    return {
      id: item.id,
      kind: "tool",
      role: "tool",
      text: "Context compaction",
      toolLabel: "contextCompaction",
      turnId,
      itemId: item.id,
    };
  }

  return null;
}

type CommandExecutionItem = Extract<ThreadItem, { type: "commandExecution" }>;
type CommandAction = CommandExecutionItem["commandActions"][number];
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;
type ReasoningItem = Extract<ThreadItem, { type: "reasoning" }>;
type WebSearchItem = Extract<ThreadItem, { type: "webSearch" }>;

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
    actions[0] ??
    null
  );
}

function commandActionValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  const match = command.match(/^(?:\/bin\/)?zsh\s+-lc\s+(.+)$/);
  if (!match) return command;
  return unquoteShellCommand(match[1].trim());
}

function unquoteShellCommand(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  return quote === "'" ? inner.replace(/'\\''/g, "'") : inner.replace(/\\(["\\$`])/g, "$1");
}

function quoteInline(value: string): string {
  return value.includes(" ") ? JSON.stringify(value) : value;
}

function fileChangeTargetLabel(changes: DisplayFileChange[]): string {
  if (changes.length === 0) return "no files";
  if (changes.length === 1) return changes[0]?.path ?? "1 file";
  return `${changes.length} files`;
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
  const rows: Array<{ key: string; value: string }> = [];
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
    typeof exitCode === "number" && exitCode !== 0 ? `exit ${exitCode}` : statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    kind: "command",
    role: "tool",
    actionLabel: commandActionLabel(item),
    text: compactToolSummary(null, target, qualifier),
    turnId,
    itemId: item.id,
    command: item.command,
    cwd: item.cwd ?? "(unknown)",
    status: item.status ?? "(unknown)",
    exitCode,
    durationMs,
    output: item.aggregatedOutput ?? "",
    state: classifyExecutionState({ exitCode, status: item.status }),
  };
}

export function fileChangeDisplayItem(item: FileChangeItem, turnId?: string): DisplayItem {
  const changes = normalizeFileChanges(item.changes ?? []);
  const qualifier = statusQualifier(item.status, failedStatusLabel(item.status));
  return {
    id: item.id,
    kind: "fileChange",
    role: "tool",
    text: compactToolSummary(null, fileChangeTargetLabel(changes), qualifier),
    turnId,
    itemId: item.id,
    status: item.status,
    changes,
    state: classifyExecutionState({ status: item.status }),
  };
}

export function planProgressDisplayItem(turnId: string, explanation: string | null, plan: TurnPlanStep[]): DisplayItem {
  const lines = plan.map((step) => `${taskStatusMarker(step.status)} ${step.step}`);
  const body = [explanation?.trim(), ...lines].filter((line): line is string => Boolean(line && line.length > 0)).join("\n");
  const status = plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "inProgress" : "completed";
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    text: body || "Plan updated",
    turnId,
    itemId: `plan-progress-${turnId}`,
    explanation: explanation?.trim() || null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    status,
    state: classifyExecutionState({ status }),
  };
}

export function normalizeFileChanges(changes: unknown[]): DisplayFileChange[] {
  return changes.flatMap((change) => {
    if (!change || typeof change !== "object") return [];
    const record = change as { kind?: unknown; path?: unknown; diff?: unknown; unified_diff?: unknown };
    return [
      {
        kind: typeof record.kind === "string" ? record.kind : "changed",
        path: typeof record.path === "string" && record.path.length > 0 ? record.path : "(unknown)",
        diff: typeof record.diff === "string" ? record.diff : typeof record.unified_diff === "string" ? record.unified_diff : "",
      },
    ];
  });
}

export function shouldSuppressThreadItem(item: { type: string }): boolean {
  return item.type === "outputMessage" || item.type === "toolOutputMessage";
}

export function shouldSuppressLifecycleItem(item: ThreadItem): boolean {
  return item.type === "agentMessage" || item.type === "userMessage";
}

export function pathRelativeToWorkspace(path: string, workspaceRoot?: string | null): string {
  return pathRelativeToRoot(path, workspaceRoot);
}

export function createSystemItem(text: string): DisplayItem {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: "system",
    role: "system",
    text,
  };
}
