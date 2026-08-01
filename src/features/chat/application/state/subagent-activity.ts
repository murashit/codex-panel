import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  type AgentCoordinationLifecycle,
  type AgentCoordinationOutcome,
  type AgentCoordinationUpdate,
  applyAgentCoordinationUpdate,
  UNKNOWN_AGENT_COORDINATION_LIFECYCLE,
} from "../../domain/thread-stream/semantics/agent-coordination";
import {
  appendAssistantStreamingDelta,
  appendPlanStreamingDelta,
  appendTextStreamingDelta,
  appendToolOutputStreamingDelta,
} from "../../domain/thread-stream/streaming-deltas";
import { upsertThreadStreamItemById } from "../../domain/thread-stream/updates";

interface SubagentActivityEntry extends AgentCoordinationLifecycle {
  readonly threadId: string;
  readonly childTurnId: string | null;
  readonly latestItem: ThreadStreamItem | null;
  readonly agentLabel: string | null;
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
      outcome: AgentCoordinationOutcome;
    };

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
    case "subagent-activity/turn-started":
      return updateTrackedEntry(state, action.threadId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: null,
        liveness: "running",
        outcome: null,
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
        latestItem: appendAssistantStreamingDelta(entry.latestItem, action.itemId, action.childTurnId, action.delta),
      }));
    case "subagent-activity/plan-delta-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendPlanStreamingDelta(entry.latestItem, action.itemId, action.childTurnId, action.delta),
      }));
    case "subagent-activity/text-delta-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendTextStreamingDelta(entry.latestItem, action.itemId, action.childTurnId, action.label, action.delta, action.kind),
      }));
    case "subagent-activity/tool-output-appended":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: appendToolOutputStreamingDelta(entry.latestItem, action.itemId, action.childTurnId, action.delta, action.fallbackLabel),
      }));
    case "subagent-activity/turn-completed":
      return updateCurrentTurnEntry(state, action.threadId, action.childTurnId, (entry) => ({
        ...entry,
        childTurnId: action.childTurnId,
        latestItem: latestDisplayableItem(action.items) ?? entry.latestItem,
        liveness: "stopped",
        outcome: action.outcome,
      }));
  }
}

function trackSubagent(state: ChatSubagentActivityState, threadId: string): ChatSubagentActivityState {
  if (state.byThreadId.has(threadId)) return state;
  const byThreadId = new Map(state.byThreadId);
  byThreadId.set(threadId, {
    threadId,
    childTurnId: null,
    latestItem: null,
    agentLabel: null,
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
