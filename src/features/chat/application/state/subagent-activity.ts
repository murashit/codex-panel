import { streamedTextThreadStreamItem, streamedToolOutputThreadStreamItem } from "../../domain/thread-stream/factories/streaming-items";
import { normalizeProposedPlanMarkdown } from "../../domain/thread-stream/format/proposed-plan";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { upsertThreadStreamItemById } from "../../domain/thread-stream/updates";

interface SubagentActivityEntry {
  readonly threadId: string;
  readonly childTurnId: string | null;
  readonly latestItem: ThreadStreamItem | null;
  readonly executionState: "running" | "completed" | "failed";
}

export interface ChatSubagentActivityState {
  readonly parentTurnId: string | null;
  readonly byThreadId: ReadonlyMap<string, SubagentActivityEntry>;
}

export type SubagentActivityAction =
  | { type: "subagent-activity/tracked"; threadId: string; parentTurnId: string }
  | { type: "subagent-activity/turn-started"; threadId: string; childTurnId: string }
  | { type: "subagent-activity/item-observed"; threadId: string; item: ThreadStreamItem; advance: boolean }
  | { type: "subagent-activity/assistant-delta-appended"; threadId: string; childTurnId: string; itemId: string; delta: string }
  | { type: "subagent-activity/plan-delta-appended"; threadId: string; childTurnId: string; itemId: string; delta: string }
  | {
      type: "subagent-activity/text-delta-appended";
      threadId: string;
      childTurnId: string;
      itemId: string;
      label: string;
      delta: string;
      kind: "tool" | "hook" | "reasoning";
    }
  | {
      type: "subagent-activity/tool-output-appended";
      threadId: string;
      childTurnId: string;
      itemId: string;
      delta: string;
      fallbackLabel: string;
    }
  | {
      type: "subagent-activity/turn-completed";
      threadId: string;
      childTurnId: string;
      items: readonly ThreadStreamItem[];
      executionState: "completed" | "failed";
    }
  | { type: "subagent-activity/execution-state-changed"; threadId: string; executionState: "completed" | "failed" };

export function initialSubagentActivityState(parentTurnId: string | null = null): ChatSubagentActivityState {
  return { parentTurnId, byThreadId: new Map() };
}

export function subagentActivityWithParentTurn(state: ChatSubagentActivityState, parentTurnId: string): ChatSubagentActivityState {
  return state.parentTurnId === parentTurnId ? state : initialSubagentActivityState(parentTurnId);
}

export function isSubagentActivityAction(action: { type: string }): action is SubagentActivityAction {
  return action.type.startsWith("subagent-activity/");
}

export function reduceSubagentActivitySlice(state: ChatSubagentActivityState, action: SubagentActivityAction): ChatSubagentActivityState {
  switch (action.type) {
    case "subagent-activity/tracked":
      return trackSubagent(state, action.threadId, action.parentTurnId);
    case "subagent-activity/turn-started":
      return updateTrackedEntry(state, action.threadId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: null,
        executionState: "running",
      }));
    case "subagent-activity/item-observed":
      return updateTrackedEntry(state, action.threadId, (entry) => {
        if (isStaleChildTurn(entry, action.item.turnId)) return entry;
        return {
          ...entry,
          childTurnId: action.item.turnId ?? entry.childTurnId,
          latestItem: observedLatestItem(entry.latestItem, action.item, action.advance),
        };
      });
    case "subagent-activity/assistant-delta-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendAssistantDelta(entry.latestItem, action.itemId, action.childTurnId, action.delta),
      }));
    case "subagent-activity/plan-delta-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendPlanDelta(entry.latestItem, action.itemId, action.childTurnId, action.delta),
      }));
    case "subagent-activity/text-delta-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendTextDelta(entry.latestItem, action.itemId, action.childTurnId, action.label, action.delta, action.kind),
      }));
    case "subagent-activity/tool-output-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendToolOutput(entry.latestItem, action.itemId, action.childTurnId, action.delta, action.fallbackLabel),
      }));
    case "subagent-activity/turn-completed":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: latestDisplayableItem(action.items) ?? entry.latestItem,
        executionState: action.executionState,
      }));
    case "subagent-activity/execution-state-changed":
      return updateTrackedEntry(state, action.threadId, (entry) => ({ ...entry, executionState: action.executionState }));
  }
}

function trackSubagent(state: ChatSubagentActivityState, threadId: string, parentTurnId: string): ChatSubagentActivityState {
  const current = state.parentTurnId === parentTurnId ? state : initialSubagentActivityState(parentTurnId);
  if (current.byThreadId.has(threadId)) return current;
  const byThreadId = new Map(current.byThreadId);
  byThreadId.set(threadId, { threadId, childTurnId: null, latestItem: null, executionState: "running" });
  return { ...current, byThreadId };
}

function updateTrackedEntry(
  state: ChatSubagentActivityState,
  threadId: string,
  update: (entry: SubagentActivityEntry) => SubagentActivityEntry,
): ChatSubagentActivityState {
  const entry = state.byThreadId.get(threadId);
  if (!entry) return state;
  const next = update(entry);
  if (next === entry) return state;
  const byThreadId = new Map(state.byThreadId);
  byThreadId.set(threadId, next);
  return { ...state, byThreadId };
}

function updateCurrentTurnEntry(
  state: ChatSubagentActivityState,
  threadId: string,
  childTurnId: string,
  update: (entry: SubagentActivityEntry) => SubagentActivityEntry,
): ChatSubagentActivityState {
  return updateTrackedEntry(state, threadId, (entry) => (isStaleChildTurn(entry, childTurnId) ? entry : update(entry)));
}

function isStaleChildTurn(entry: SubagentActivityEntry, childTurnId: string | null | undefined): boolean {
  return Boolean(entry.childTurnId && childTurnId && entry.childTurnId !== childTurnId);
}

function observedLatestItem(current: ThreadStreamItem | null, item: ThreadStreamItem, advance: boolean): ThreadStreamItem | null {
  if (advance || !current) return item;
  if (!sameSourceItem(current, item.id)) return current;
  return upsertThreadStreamItemById([current], item)[0] ?? item;
}

function appendAssistantDelta(current: ThreadStreamItem | null, itemId: string, turnId: string, delta: string): ThreadStreamItem {
  if (current && sameSourceItem(current, itemId) && current.kind === "dialogue" && current.dialogueKind === "assistantResponse") {
    return {
      ...current,
      text: `${current.text}${delta}`,
      copyText: `${current.text}${delta}`,
      turnId,
      dialogueState: "streaming",
    };
  }
  return {
    id: itemId,
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text: delta,
    copyText: delta,
    turnId,
    sourceItemId: itemId,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: itemId },
    dialogueState: "streaming",
  };
}

function appendPlanDelta(current: ThreadStreamItem | null, itemId: string, turnId: string, delta: string): ThreadStreamItem {
  const previousText =
    current && sameSourceItem(current, itemId) && current.kind === "dialogue" && current.role === "assistant" ? current.text : "";
  const text = normalizeProposedPlanMarkdown(`${previousText}${delta}`);
  return {
    id: itemId,
    kind: "dialogue",
    dialogueKind: "proposedPlan",
    role: "assistant",
    text,
    copyText: text,
    turnId,
    sourceItemId: itemId,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: itemId },
    dialogueState: "streaming",
  };
}

function appendTextDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ThreadStreamItem {
  if (current && sameSourceItem(current, itemId) && current.kind === kind) {
    return { ...current, text: `${current.text ?? ""}${delta}`, turnId };
  }
  return streamedTextThreadStreamItem({ id: itemId, turnId, label, delta, kind });
}

function appendToolOutput(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): ThreadStreamItem {
  if (current && sameSourceItem(current, itemId) && (current.kind === "tool" || current.kind === "hook")) {
    return { ...current, output: `${current.output ?? ""}${delta}`, turnId };
  }
  return streamedToolOutputThreadStreamItem({ id: itemId, turnId, output: delta, fallbackLabel });
}

function latestDisplayableItem(items: readonly ThreadStreamItem[]): ThreadStreamItem | null {
  return [...items].reverse().find((item) => item.kind !== "system" && !(item.kind === "dialogue" && item.role === "user")) ?? null;
}

function sameSourceItem(item: ThreadStreamItem, sourceItemId: string): boolean {
  return item.id === sourceItemId || item.sourceItemId === sourceItemId;
}
