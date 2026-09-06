import {
  type AgentCoordinationLifecycle,
  type AgentCoordinationUpdate,
  applyAgentCoordinationUpdate,
  UNKNOWN_AGENT_COORDINATION_LIFECYCLE,
} from "../../domain/thread-stream/agent-coordination";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  appendAssistantStreamingDelta,
  appendPlanStreamingDelta,
  appendTextStreamingDelta,
  appendToolOutputStreamingDelta,
} from "../../domain/thread-stream/streaming-items";
import { upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import type { TurnRuntimeFact } from "../turns/runtime-facts";

interface SubagentActivityEntry extends AgentCoordinationLifecycle {
  readonly threadId: string;
  readonly childTurnId: string | null;
  readonly latestItem: ThreadStreamItem | null;
  readonly agentLabel: string | null;
  readonly statusPreview: string | null;
}

export interface ChatSubagentActivityState {
  readonly byThreadId: ReadonlyMap<string, SubagentActivityEntry>;
}

export type SubagentActivityAction =
  | { type: "subagent-activity/tracked"; threadId: string; parentTurnId: string }
  | {
      type: "subagent-activity/coordination-observed";
      threadId: string;
      parentTurnId: string;
      agentLabel: string | null;
      coordinationUpdate: Exclude<AgentCoordinationUpdate, "snapshot">;
    }
  | { type: "subagent-activity/runtime-fact"; threadId: string; fact: TurnRuntimeFact };

export function initialSubagentActivityState(): ChatSubagentActivityState {
  return { byThreadId: new Map() };
}

export function isSubagentActivityAction(action: { type: string }): action is SubagentActivityAction {
  return action.type.startsWith("subagent-activity/");
}

export function reduceSubagentActivitySlice(state: ChatSubagentActivityState, action: SubagentActivityAction): ChatSubagentActivityState {
  switch (action.type) {
    case "subagent-activity/tracked":
      return trackSubagent(state, action.threadId);
    case "subagent-activity/coordination-observed":
      return observeCoordinationUpdate(state, action.threadId, action.agentLabel, action.coordinationUpdate);
    case "subagent-activity/runtime-fact":
      return reduceChildRuntimeFact(state, action.threadId, action.fact);
  }
}

function reduceChildRuntimeFact(state: ChatSubagentActivityState, threadId: string, fact: TurnRuntimeFact): ChatSubagentActivityState {
  switch (fact.type) {
    case "turnStarted":
      return updateTrackedEntry(state, threadId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: null,
        statusPreview: null,
        liveness: "running",
        outcome: null,
      }));
    case "itemStarted":
    case "taskProgressUpdated":
      return observeItem(state, threadId, fact.item, true);
    case "itemContentUpdated":
      return observeItem(state, threadId, fact.item, false);
    case "itemCompleted":
      return observeItem(state, threadId, fact.item, false);
    case "hookRunObserved":
      return fact.turnId ? observeItem(state, threadId, { ...fact.item, turnId: fact.turnId }, true) : state;
    case "autoReviewUpdated":
    case "reviewWarning":
      return observeItem(state, threadId, fact.item, true);
    case "assistantDelta":
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: appendAssistantStreamingDelta(entry.latestItem, fact.itemId, fact.turnId, fact.delta),
        statusPreview: null,
      }));
    case "planDelta":
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: appendPlanStreamingDelta(entry.latestItem, fact.itemId, fact.turnId, fact.delta),
        statusPreview: null,
      }));
    case "textDelta":
      if (fact.source === "body") return state;
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: appendTextStreamingDelta(entry.latestItem, fact.itemId, fact.turnId, fact.label, fact.delta, fact.kind),
        statusPreview: null,
      }));
    case "toolOutputDelta":
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: appendToolOutputStreamingDelta(entry.latestItem, fact.itemId, fact.turnId, fact.delta, fact.fallbackLabel),
        statusPreview: null,
      }));
    case "authRecoveryUpdated":
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        statusPreview: fact.progress.message,
      }));
    case "turnCompleted":
      return updateCurrentTurnEntry(state, threadId, fact.turnId, (entry) => ({
        ...entry,
        childTurnId: fact.turnId,
        latestItem: latestDisplayableItem(fact.completedItems) ?? entry.latestItem,
        liveness: "stopped",
        outcome: fact.status === "completed" || fact.status === "failed" ? fact.status : null,
        statusPreview: null,
      }));
    case "userMessageObserved":
    case "itemOutputDelta":
    case "turnDiffUpdated":
    case "requestResolved":
    case "systemNotice":
      return state;
  }
}

function observeItem(
  state: ChatSubagentActivityState,
  threadId: string,
  item: ThreadStreamItem,
  advance: boolean,
): ChatSubagentActivityState {
  return updateTrackedEntry(state, threadId, (entry) => {
    if (isStaleChildTurn(entry, item.turnId)) return entry;
    return {
      ...entry,
      childTurnId: item.turnId ?? entry.childTurnId,
      latestItem: observedLatestItem(entry.latestItem, item, advance),
      statusPreview: null,
    };
  });
}

function trackSubagent(state: ChatSubagentActivityState, threadId: string): ChatSubagentActivityState {
  if (state.byThreadId.has(threadId)) return state;
  const byThreadId = new Map(state.byThreadId);
  byThreadId.set(threadId, {
    threadId,
    childTurnId: null,
    latestItem: null,
    agentLabel: null,
    statusPreview: null,
    ...UNKNOWN_AGENT_COORDINATION_LIFECYCLE,
  });
  return { ...state, byThreadId };
}

function observeCoordinationUpdate(
  state: ChatSubagentActivityState,
  threadId: string,
  agentLabel: string | null,
  coordinationUpdate: Exclude<AgentCoordinationUpdate, "snapshot">,
): ChatSubagentActivityState {
  const tracked = trackSubagent(state, threadId);
  return updateTrackedEntry(tracked, threadId, (entry) => {
    return { ...entry, ...applyAgentCoordinationUpdate(entry, coordinationUpdate), agentLabel };
  });
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

function latestDisplayableItem(items: readonly ThreadStreamItem[]): ThreadStreamItem | null {
  return [...items].reverse().find((item) => item.kind !== "system" && !(item.kind === "dialogue" && item.role === "user")) ?? null;
}

function sameSourceItem(item: ThreadStreamItem, sourceItemId: string): boolean {
  return item.id === sourceItemId || item.sourceItemId === sourceItemId;
}
