import type { DisplayBlock, DisplayDetailSection, DisplayFileChange, DisplayItem, DisplayKind } from "./types";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { TurnPlanStep } from "../generated/app-server/v2/TurnPlanStep";
import { inputToText, jsonPreview, truncate } from "../utils";
import { taskStatusMarker } from "./labels";
import { agentDisplayItem } from "./agent";
import { classifyExecutionState, executionState } from "./state";
export { activeAgentRunSummary, agentDisplayItem } from "./agent";
export { classifyExecutionState, executionState, executionStateLabel } from "./state";
export { createAutoReviewResultItem, createReviewResultItem } from "./review";

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
      details: [
        { title: "Arguments JSON", body: jsonPreview(item.arguments) },
        ...(item.result ? [{ title: "Result JSON", body: jsonPreview(item.result) }] : []),
        ...(item.error ? [{ title: "Error JSON", body: jsonPreview(item.error) }] : []),
      ],
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
      details: [
        { title: "Arguments JSON", body: jsonPreview(item.arguments) },
        ...(item.contentItems ? [{ title: "Result JSON", body: jsonPreview(item.contentItems) }] : []),
      ],
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
      turnId,
      itemId: item.id,
      status: item.status,
      details: [
        ...(item.savedPath ? [{ title: "Saved path", body: item.savedPath }] : []),
        ...(item.revisedPrompt ? [{ title: "Revised prompt", body: item.revisedPrompt }] : []),
        ...(item.result ? [{ title: "Result", body: item.result }] : []),
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

const TOOL_SUMMARY_LIMIT = 140;

function reasoningText(item: ReasoningItem): string {
  return [...item.summary, ...item.content]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function compactToolSummary(label: string | null, target?: string | null, qualifier?: string | null): string {
  const targetText = target?.trim();
  const base = label ? (targetText ? `${label}: ${targetText}` : label) : (targetText ?? "details");
  return truncate(qualifier ? `${base} (${qualifier})` : base, TOOL_SUMMARY_LIMIT);
}

function statusQualifier(status: unknown, failure?: string | null): string | null {
  if (status === "declined") return "declined";
  if (status === "failed") return failure || "failed";
  return null;
}

function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function commandTargetLabel(item: CommandExecutionItem): string {
  const action = representativeCommandAction(item.commandActions);
  if (action?.type === "search") {
    const query = commandActionValue(action.query);
    const path = commandActionValue(action.path);
    if (query && path) return `${quoteInline(query)} in ${path}`;
    if (query) return quoteInline(query);
    if (path) return path;
  }
  if (action?.type === "read") return commandReadTargetLabel(action, item.cwd);
  if (action?.type === "listFiles") return commandActionValue(action.path) ?? "workspace";
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

  return rows.length > 0 ? [{ title: "web search", rows }] : [];
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

export function upsertDisplayItem(items: DisplayItem[], next: DisplayItem): DisplayItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  const previous = copy[index];
  copy[index] = {
    ...previous,
    ...next,
    output: mergeOutput(previous, next),
    changes: mergeChanges(previous, next),
  } as DisplayItem;
  return copy;
}

function mergeOutput(previous: DisplayItem, next: DisplayItem): string | undefined {
  const previousOutput = "output" in previous ? previous.output : undefined;
  const nextOutput = "output" in next ? next.output : undefined;
  return nextOutput && nextOutput.length > 0 ? nextOutput : previousOutput;
}

function mergeChanges(previous: DisplayItem, next: DisplayItem): DisplayFileChange[] | undefined {
  const previousChanges = previous.kind === "fileChange" ? previous.changes : undefined;
  const nextChanges = next.kind === "fileChange" ? next.changes : undefined;
  return nextChanges && nextChanges.length > 0 ? nextChanges : previousChanges;
}

export function appendAssistantDelta(items: DisplayItem[], itemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId && item.kind === "message" && item.role === "assistant");
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && item.kind === "message"
        ? {
            ...item,
            text: `${item.text}${delta}`,
            copyText: `${item.text}${delta}`,
            turnId: item.turnId ?? turnId,
            markdown: false,
          }
        : item,
    );
  }
  return [
    ...items,
    {
      id: itemId,
      kind: "message",
      role: "assistant",
      text: delta,
      copyText: delta,
      turnId,
      itemId,
      markdown: false,
    },
  ];
}

export function completeReasoningItems(items: DisplayItem[], turnId: string): DisplayItem[] {
  return items.map((item) =>
    item.kind === "reasoning" && item.turnId === turnId
      ? {
          ...item,
          status: "completed",
          state: "completed",
        }
      : item,
  );
}

export function appendPlanDelta(items: DisplayItem[], itemId: string, turnId: string, delta: string): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId && item.kind === "message" && item.role === "assistant");
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && item.kind === "message" ? appendPlanDeltaToMessage(item, turnId, delta) : item,
    );
  }
  const text = normalizeProposedPlanMarkdown(delta);
  return [
    ...items,
    {
      id: itemId,
      kind: "message",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      itemId,
      markdown: false,
    },
  ];
}

function appendPlanDeltaToMessage(item: Extract<DisplayItem, { kind: "message" }>, turnId: string, delta: string): DisplayItem {
  const text = normalizeProposedPlanMarkdown(`${item.text}${delta}`);
  return {
    ...item,
    text,
    copyText: text,
    turnId: item.turnId ?? turnId,
    markdown: false,
  };
}

export function normalizeProposedPlanMarkdown(text: string): string {
  return text
    .replace(/^\s*<proposed_plan>\s*\n?/i, "")
    .replace(/\n?\s*<\/proposed_plan>\s*$/i, "")
    .trim();
}

export function appendItemText(
  items: DisplayItem[],
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
  if (index !== -1) {
    return items.map((item, itemIndex) => (itemIndex === index ? { ...item, text: `${item.text}${delta}` } : item));
  }
  return [
    ...items,
    {
      id: itemId,
      kind,
      role: "tool",
      text: `${label}: ${delta}`,
      turnId,
      itemId,
    },
  ];
}

export function appendToolOutput(
  items: DisplayItem[],
  itemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && (item.kind === "tool" || item.kind === "hook" || item.kind === "reasoning")
        ? { ...item, output: `${item.output ?? ""}${delta}` }
        : item,
    );
  }
  return [
    ...items,
    {
      id: itemId,
      kind: "tool",
      role: "tool",
      text: "details",
      toolLabel: fallbackLabel,
      turnId,
      itemId,
      output: delta,
    },
  ];
}

export function appendItemOutput(
  items: DisplayItem[],
  itemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): DisplayItem[] {
  const index = items.findIndex((item) => item.itemId === itemId);
  if (index !== -1) {
    return items.map((item, itemIndex) =>
      itemIndex === index && (item.kind === "command" || item.kind === "fileChange")
        ? { ...item, output: `${item.output ?? ""}${delta}` }
        : item,
    );
  }
  return [
    ...items,
    {
      id: itemId,
      kind,
      role: "tool",
      text: fallbackText,
      turnId,
      itemId,
      output: delta,
      ...(kind === "fileChange"
        ? {
            status: "inProgress",
            changes: [],
          }
        : {
            command: fallbackText,
            cwd: "(unknown)",
            status: "running",
          }),
    },
  ] as DisplayItem[];
}

export function displayBlocksForItems(items: DisplayItem[], activeTurnId: string | null, workspaceRoot?: string | null): DisplayBlock[] {
  const visibleItems = items.filter(shouldShowDisplayItem);
  const orderedItems = activeTurnId ? moveActiveTaskProgressToEnd(visibleItems, activeTurnId) : visibleItems;
  const editedFilesByTurn = editedFilesForTurns(visibleItems, workspaceRoot);
  const finalAssistantIdByTurn = finalAssistantItemsByTurn(visibleItems);
  const groupedTurnIds = new Set([...finalAssistantIdByTurn.keys()].filter((turnId) => turnId !== activeTurnId));

  const groupedActivities = new Map<string, DisplayItem[]>();
  for (const item of orderedItems) {
    if (!item.turnId || !groupedTurnIds.has(item.turnId) || !isCompletedTurnDetailItem(item, finalAssistantIdByTurn)) continue;
    const group = groupedActivities.get(item.turnId) ?? [];
    group.push(item);
    groupedActivities.set(item.turnId, group);
  }

  const emittedGroups = new Set<string>();
  const blocks: DisplayBlock[] = [];
  for (const item of orderedItems) {
    const turnId = item.turnId;
    if (turnId && groupedActivities.has(turnId) && isCompletedTurnDetailItem(item, finalAssistantIdByTurn)) {
      if (!emittedGroups.has(turnId)) {
        const groupItems = groupedActivities.get(turnId) ?? [];
        blocks.push({
          type: "activityGroup",
          id: `turn-${turnId}-activity`,
          turnId,
          summary: turnActivitySummary(groupItems),
          items: groupItems,
        });
        emittedGroups.add(turnId);
      }
      continue;
    }
    blocks.push({ type: "item", item: itemWithEditedFiles(item, editedFilesByTurn, finalAssistantIdByTurn) });
  }

  return blocks;
}

function moveActiveTaskProgressToEnd(items: DisplayItem[], activeTurnId: string): DisplayItem[] {
  const activeTaskProgress = items.filter((item) => item.kind === "taskProgress" && item.turnId === activeTurnId);
  if (activeTaskProgress.length === 0) return items;
  return [...items.filter((item) => item.kind !== "taskProgress" || item.turnId !== activeTurnId), ...activeTaskProgress];
}

function shouldShowDisplayItem(item: DisplayItem): boolean {
  return item.kind !== "reasoning" || executionState(item) !== "completed" || item.text.trim().length > 0;
}

function isCompletedTurnDetailItem(item: DisplayItem, finalAssistantIdByTurn: Map<string, string>): boolean {
  if (!item.turnId || item.role === "user") return false;
  return finalAssistantIdByTurn.get(item.turnId) !== item.id;
}

function finalAssistantItemsByTurn(items: DisplayItem[]): Map<string, string> {
  const finalAssistantIdByTurn = new Map<string, string>();
  for (const item of items) {
    if (!item.turnId || !isFinalAssistantMessage(item)) continue;
    finalAssistantIdByTurn.set(item.turnId, item.id);
  }
  return finalAssistantIdByTurn;
}

function isFinalAssistantMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "assistant" && item.markdown !== false;
}

function itemWithEditedFiles(
  item: DisplayItem,
  editedFilesByTurn: Map<string, string[]>,
  finalAssistantIdByTurn: Map<string, string>,
): DisplayItem {
  if (!item.turnId || finalAssistantIdByTurn.get(item.turnId) !== item.id) return item;
  if (item.kind !== "message") return item;
  const editedFiles = editedFilesByTurn.get(item.turnId);
  if (!editedFiles || editedFiles.length === 0) return item;
  return { ...item, editedFiles };
}

function editedFilesForTurns(items: DisplayItem[], workspaceRoot?: string | null): Map<string, string[]> {
  const byTurn = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.turnId || item.kind !== "fileChange") continue;
    const files = editedFilesForItem(item, workspaceRoot);
    if (files.length === 0) continue;
    const set = byTurn.get(item.turnId) ?? new Set<string>();
    files.forEach((file) => set.add(file));
    byTurn.set(item.turnId, set);
  }

  return new Map([...byTurn].map(([turnId, files]) => [turnId, [...files].sort((a, b) => a.localeCompare(b))]));
}

function editedFilesForItem(item: DisplayItem, workspaceRoot?: string | null): string[] {
  if (item.kind !== "fileChange") return [];
  return item.changes.flatMap((change) =>
    change.path && change.path !== "(unknown)" ? [pathRelativeToWorkspace(change.path, workspaceRoot)] : [],
  );
}

export function pathRelativeToWorkspace(path: string, workspaceRoot?: string | null): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const root = workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return normalizedPath;
  if (normalizedPath === root) return ".";
  return normalizedPath.startsWith(`${root}/`) ? normalizedPath.slice(root.length + 1) : normalizedPath;
}

function turnActivitySummary(items: DisplayItem[]): string {
  const parts = [
    countMatchingLabel(items, (item) => item.kind === "message" && item.role === "assistant", "response", "responses"),
    countLabel(items, "taskProgress", "task progress"),
    countLabel(items, "agent", "agent"),
    countLabel(items, "command", "command"),
    countLabel(items, "fileChange", "file change"),
    countLabel(items, "tool", "tool"),
    countLabel(items, "hook", "hook"),
    countLabel(items, "reasoning", "thought", "thought notes"),
    countLabel(items, "approvalResult", "approval"),
    countLabel(items, "userInputResult", "input"),
    countLabel(items, "reviewResult", "review"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "Work details";
  return `Work details: ${parts.join(", ")}`;
}

function countMatchingLabel(
  items: DisplayItem[],
  predicate: (item: DisplayItem) => boolean,
  label: string,
  pluralLabel = `${label}s`,
): string | null {
  const count = items.filter(predicate).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${count} ${pluralLabel}`;
}

function countLabel(items: DisplayItem[], kind: DisplayKind, label: string, pluralLabel = `${label}s`): string | null {
  const count = items.filter((item) => item.kind === kind).length;
  if (count === 0) return null;
  if (count === 1) return label;
  return `${count} ${pluralLabel}`;
}

export function createSystemItem(text: string): DisplayItem {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: "system",
    role: "system",
    text,
  };
}
