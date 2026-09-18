import { threadStreamUserRoles } from "../../domain/thread-stream/conversation";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  appendAssistantStreamingDelta,
  appendPlanStreamingDelta,
  appendTextStreamingDelta,
  appendToolOutputStreamingDelta,
  streamedItemOutputThreadStreamItem,
} from "../../domain/thread-stream/streaming-items";
import { completeReasoningItems, mergeThreadStreamItem, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import { definedPatch, patchObject } from "./patch";

interface ChatThreadStreamActiveSegment {
  readonly turnId: string | null;
  readonly items: readonly ThreadStreamItem[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly indexBySourceItemId: ReadonlyMap<string, number>;
}

export interface ChatThreadStreamState {
  readonly stableItems: readonly ThreadStreamItem[];
  readonly turnDiffs: ReadonlyMap<string, string>;
  readonly historyCursor: string | null;
  readonly loadingHistory: boolean;
  readonly reportedLogs: ReadonlySet<string>;
}

export interface ChatThreadStreamActiveState {
  readonly activeSegment: ChatThreadStreamActiveSegment | null;
  readonly pendingSteers: readonly ThreadStreamDialogueItem[];
}

export type ChatThreadStreamViewState = ChatThreadStreamState & ChatThreadStreamActiveState;

export interface ThreadStreamRollbackCandidate {
  turnId: string;
  itemId: string;
  text: string;
}

export type ThreadStreamAction =
  | { type: "thread-stream/item-added"; item: ThreadStreamItem }
  | { type: "thread-stream/system-item-added"; item: ThreadStreamItem }
  | { type: "thread-stream/deduped-log-added"; text: string; item: ThreadStreamItem }
  | { type: "thread-stream/history-loading-set"; loading: boolean }
  | {
      type: "thread-stream/content-replaced";
      items: readonly ThreadStreamItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
    }
  | { type: "thread-stream/item-upserted"; item: ThreadStreamItem }
  | { type: "thread-stream/pending-steer-added"; item: ThreadStreamDialogueItem }
  | { type: "thread-stream/pending-steer-removed"; clientId: string }
  | { type: "thread-stream/pending-steer-committed"; item: ThreadStreamDialogueItem }
  | { type: "thread-stream/reasoning-completed"; turnId: string }
  | { type: "thread-stream/assistant-delta-appended"; itemId: string; turnId: string; delta: string; completeReasoning?: boolean }
  | { type: "thread-stream/plan-delta-appended"; itemId: string; turnId: string; delta: string }
  | {
      type: "thread-stream/item-text-appended";
      itemId: string;
      turnId: string;
      label: string;
      delta: string;
      kind: "tool" | "hook" | "reasoning";
    }
  | {
      type: "thread-stream/tool-output-appended";
      itemId: string;
      turnId: string;
      delta: string;
      fallbackLabel: string;
    }
  | {
      type: "thread-stream/item-output-appended";
      itemId: string;
      turnId: string;
      delta: string;
      kind: "command" | "fileChange";
      fallbackText: string;
    }
  | { type: "thread-stream/turn-diff-updated"; turnId: string; diff: string };

export function isThreadStreamAction(action: { type: string }): action is ThreadStreamAction {
  switch (action.type) {
    case "thread-stream/item-added":
    case "thread-stream/system-item-added":
    case "thread-stream/deduped-log-added":
    case "thread-stream/history-loading-set":
    case "thread-stream/content-replaced":
    case "thread-stream/item-upserted":
    case "thread-stream/pending-steer-added":
    case "thread-stream/pending-steer-removed":
    case "thread-stream/pending-steer-committed":
    case "thread-stream/reasoning-completed":
    case "thread-stream/assistant-delta-appended":
    case "thread-stream/plan-delta-appended":
    case "thread-stream/item-text-appended":
    case "thread-stream/tool-output-appended":
    case "thread-stream/item-output-appended":
    case "thread-stream/turn-diff-updated":
      return true;
    default:
      return false;
  }
}

export function initialChatThreadStreamState(items: readonly ThreadStreamItem[] = []): ChatThreadStreamState {
  return {
    stableItems: items,
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  };
}

export function threadStreamItems(state: ChatThreadStreamViewState): readonly ThreadStreamItem[] {
  if (!state.activeSegment || state.activeSegment.items.length === 0) return state.stableItems;
  return [...state.stableItems, ...state.activeSegment.items];
}

export function threadStreamStableItems(state: Pick<ChatThreadStreamState, "stableItems">): readonly ThreadStreamItem[] {
  return state.stableItems;
}

export function threadStreamActiveItems(state: Pick<ChatThreadStreamActiveState, "activeSegment">): readonly ThreadStreamItem[] {
  return state.activeSegment?.items ?? [];
}

export function threadStreamPendingSteers(state: Pick<ChatThreadStreamActiveState, "pendingSteers">): readonly ThreadStreamDialogueItem[] {
  return state.pendingSteers;
}

export function threadStreamIsEmpty(state: ChatThreadStreamViewState): boolean {
  return state.stableItems.length === 0 && (!state.activeSegment || state.activeSegment.items.length === 0);
}

export function threadStreamRollbackCandidate(state: ChatThreadStreamViewState): ThreadStreamRollbackCandidate | null {
  return threadStreamRollbackCandidateFromItems(threadStreamItems(state));
}

export function threadStreamRollbackCandidateFromItems(items: readonly ThreadStreamItem[]): ThreadStreamRollbackCandidate | null {
  const lastTurnId = latestTurnId(items);
  if (!lastTurnId) return null;

  const turnInitiator = turnInitiatorDialogueForTurn(items, lastTurnId);
  if (!turnInitiator) return null;

  return {
    turnId: lastTurnId,
    itemId: turnInitiator.id,
    text: turnInitiator.copyText ?? turnInitiator.text,
  };
}

export function threadStreamWithItems(
  state: ChatThreadStreamState,
  items: readonly ThreadStreamItem[],
  patch: Partial<Pick<ChatThreadStreamState, "historyCursor" | "loadingHistory">> = {},
): ChatThreadStreamState {
  return patchObject(state, { stableItems: items, ...patch });
}

export function threadStreamWithActiveTurnItems(
  state: ChatThreadStreamViewState,
  turnId: string,
  items: readonly ThreadStreamItem[],
): ChatThreadStreamViewState {
  const stableItems = items.filter((item) => item.turnId !== turnId);
  const activeItems = items.filter((item) => item.turnId === turnId);
  return patchObject(state, {
    stableItems,
    activeSegment: activeSegmentFromItems(turnId, activeItems),
    pendingSteers: state.pendingSteers.filter((item) => item.turnId === turnId),
  });
}

export function threadStreamStartActiveSegment(
  state: ChatThreadStreamViewState,
  turnId: string | null,
  items: readonly ThreadStreamItem[],
): ChatThreadStreamViewState {
  return patchObject(state, {
    activeSegment: activeSegmentFromItems(turnId, items),
    pendingSteers: state.pendingSteers.filter((item) => !turnId || item.turnId === turnId),
  });
}

export function reduceThreadStreamSlice(state: ChatThreadStreamViewState, action: ThreadStreamAction): ChatThreadStreamViewState {
  switch (action.type) {
    case "thread-stream/item-added":
    case "thread-stream/system-item-added":
      return patchObject(state, appendThreadStreamItemPatch(state, action.item));
    case "thread-stream/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchObject(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        ...appendThreadStreamItemPatch(state, action.item),
      });
    case "thread-stream/content-replaced":
      return patchObject(state, {
        ...replaceThreadStreamContent(state, action.items),
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
      });
    case "thread-stream/history-loading-set":
      return patchObject(state, { loadingHistory: action.loading });
    case "thread-stream/item-upserted":
      return upsertThreadStreamItem(state, action.item);
    case "thread-stream/pending-steer-added":
      if (!action.item.clientId) return state;
      return state.pendingSteers.some((item) => item.clientId === action.item.clientId)
        ? state
        : patchObject(state, { pendingSteers: [...state.pendingSteers, action.item] });
    case "thread-stream/pending-steer-removed":
      return removePendingSteer(state, action.clientId);
    case "thread-stream/pending-steer-committed":
      return commitPendingSteer(state, action.item);
    case "thread-stream/reasoning-completed":
      return completeReasoningInThreadStream(state, action.turnId);
    case "thread-stream/assistant-delta-appended": {
      const current = action.completeReasoning ? completeReasoningInThreadStream(state, action.turnId) : state;
      return updateStreamItemBySourceId(current, action.turnId, action.itemId, (item) =>
        appendAssistantStreamingDelta(item, action.itemId, action.turnId, action.delta),
      );
    }
    case "thread-stream/plan-delta-appended":
      return updateStreamItemBySourceId(state, action.turnId, action.itemId, (item) =>
        appendPlanStreamingDelta(item, action.itemId, action.turnId, action.delta),
      );
    case "thread-stream/item-text-appended":
      return updateStreamItemBySourceId(state, action.turnId, action.itemId, (item) =>
        appendTextStreamingDelta(item, action.itemId, action.turnId, action.label, action.delta, action.kind),
      );
    case "thread-stream/tool-output-appended":
      return updateStreamItemBySourceId(state, action.turnId, action.itemId, (item) =>
        appendToolOutputStreamingDelta(item, action.itemId, action.turnId, action.delta, action.fallbackLabel, { allowReasoning: true }),
      );
    case "thread-stream/item-output-appended":
      return updateStreamItemBySourceId(state, action.turnId, action.itemId, (item) => {
        if (item) {
          return item.kind === "command" || item.kind === "fileChange" ? { ...item, output: `${item.output ?? ""}${action.delta}` } : item;
        }
        return streamedItemOutputThreadStreamItem({
          id: action.itemId,
          turnId: action.turnId,
          output: action.delta,
          kind: action.kind,
          fallbackText: action.fallbackText,
        });
      });
    case "thread-stream/turn-diff-updated":
      return patchObject(state, {
        turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff),
      });
  }
}

function replaceThreadStreamContent(
  state: ChatThreadStreamViewState,
  items: readonly ThreadStreamItem[],
): Partial<ChatThreadStreamViewState> {
  const segment = state.activeSegment;
  if (!segment) return { stableItems: items };
  const stableItems: ThreadStreamItem[] = [];
  const activeItems: ThreadStreamItem[] = [];
  for (const item of items) {
    // Optimistic prompts and their hooks can belong to the active segment before it has a turn ID.
    const active = segment.indexById.has(item.id) || (segment.turnId !== null && item.turnId === segment.turnId);
    (active ? activeItems : stableItems).push(item);
  }
  return { stableItems, activeSegment: activeSegmentFromItems(segment.turnId, activeItems) };
}

function removePendingSteer(state: ChatThreadStreamViewState, clientId: string): ChatThreadStreamViewState {
  const pendingSteers = state.pendingSteers.filter((item) => item.clientId !== clientId);
  return pendingSteers.length === state.pendingSteers.length ? state : patchObject(state, { pendingSteers });
}

function commitPendingSteer(state: ChatThreadStreamViewState, item: ThreadStreamDialogueItem): ChatThreadStreamViewState {
  if (!item.clientId) return state;
  const pending = state.pendingSteers.find(
    (candidate) => candidate.clientId === item.clientId && (!candidate.turnId || !item.turnId || candidate.turnId === item.turnId),
  );
  if (!pending) return state;
  const committed = {
    ...item,
    ...(pending.contextAttachments ? { contextAttachments: pending.contextAttachments } : {}),
    ...(pending.referencedFiles ? { referencedFiles: pending.referencedFiles } : {}),
    ...(pending.referencedThread
      ? {
          referencedThread: item.referencedThread
            ? { ...item.referencedThread, title: pending.referencedThread.title }
            : pending.referencedThread,
        }
      : {}),
  };
  const withoutPending = removePendingSteer(state, item.clientId);
  return patchObject(withoutPending, appendThreadStreamItemPatch(withoutPending, committed));
}

function appendThreadStreamItemPatch(state: ChatThreadStreamViewState, item: ThreadStreamItem): Partial<ChatThreadStreamViewState> {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return { activeSegment: appendActiveSegmentItem(state.activeSegment, item) };
  }
  return { stableItems: [...state.stableItems, item] };
}

function upsertThreadStreamItem(state: ChatThreadStreamViewState, item: ThreadStreamItem): ChatThreadStreamViewState {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return patchObject(state, { activeSegment: upsertActiveSegmentItem(state.activeSegment, item) });
  }
  return patchObject(state, { stableItems: upsertThreadStreamItemById(state.stableItems, item) });
}

function updateStreamItemBySourceId(
  state: ChatThreadStreamViewState,
  turnId: string,
  sourceItemId: string,
  update: (item: ThreadStreamItem | null) => ThreadStreamItem,
): ChatThreadStreamViewState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, update);
    }
    return appendActiveSegmentItem(segment, update(null));
  });
}

function completeReasoningInThreadStream(state: ChatThreadStreamViewState, turnId: string): ChatThreadStreamViewState {
  const stableItems = completeReasoningItems(state.stableItems, turnId);
  const activeSegment = state.activeSegment;

  if (activeSegment?.turnId !== turnId) {
    return stableItems !== state.stableItems ? patchObject(state, { stableItems }) : state;
  }

  const activeItems = completeReasoningItems(activeSegment.items, turnId);

  return stableItems !== state.stableItems || activeItems !== activeSegment.items
    ? patchObject(state, {
        stableItems,
        activeSegment: activeItems !== activeSegment.items ? activeSegmentFromItems(activeSegment.turnId, activeItems) : activeSegment,
      })
    : state;
}

function updateActiveSegment(
  state: ChatThreadStreamViewState,
  turnId: string,
  update: (segment: ChatThreadStreamActiveSegment) => ChatThreadStreamActiveSegment,
): ChatThreadStreamViewState {
  const activeSegment = state.activeSegment;
  if (activeSegment?.turnId && activeSegment.turnId !== turnId) return state;
  const segment =
    activeSegment?.turnId === turnId
      ? activeSegment
      : activeSegment
        ? activeSegmentFromItems(turnId, activeSegment.items)
        : activeSegmentFromItems(turnId, []);
  return patchObject(state, { activeSegment: update(segment) });
}

function shouldUseActiveSegment(
  segment: ChatThreadStreamActiveSegment | null,
  item: ThreadStreamItem,
): segment is ChatThreadStreamActiveSegment {
  if (!segment) return false;
  return !item.turnId || !segment.turnId || item.turnId === segment.turnId;
}

function appendActiveSegmentItem(segment: ChatThreadStreamActiveSegment, item: ThreadStreamItem): ChatThreadStreamActiveSegment {
  const index = segment.items.length;
  const indexById = new Map(segment.indexById);
  indexById.set(item.id, index);
  const indexBySourceItemId = new Map(segment.indexBySourceItemId);
  if (item.sourceItemId) indexBySourceItemId.set(item.sourceItemId, index);
  return {
    turnId: segment.turnId,
    items: [...segment.items, item],
    indexById,
    indexBySourceItemId,
  };
}

function upsertActiveSegmentItem(segment: ChatThreadStreamActiveSegment, item: ThreadStreamItem): ChatThreadStreamActiveSegment {
  const index = segment.indexById.get(item.id);
  if (index === undefined) return appendActiveSegmentItem(segment, item);
  return replaceActiveSegmentItem(segment, index, (previous) => mergeThreadStreamItem(previous, item));
}

function replaceActiveSegmentItem(
  segment: ChatThreadStreamActiveSegment,
  index: number,
  replacement: (item: ThreadStreamItem) => ThreadStreamItem,
): ChatThreadStreamActiveSegment {
  const previous = segment.items[index];
  if (!previous) return segment;
  const next = replacement(previous);
  if (next === previous) return segment;
  const items = [...segment.items];
  items[index] = next;
  if (next.id === previous.id && next.sourceItemId === previous.sourceItemId) {
    return { ...segment, items };
  }
  return activeSegmentFromItems(segment.turnId, items);
}

function activeSegmentFromItems(turnId: string | null, items: readonly ThreadStreamItem[]): ChatThreadStreamActiveSegment {
  const indexById = new Map<string, number>();
  const indexBySourceItemId = new Map<string, number>();
  items.forEach((item, index) => {
    indexById.set(item.id, index);
    if (item.sourceItemId) indexBySourceItemId.set(item.sourceItemId, index);
  });
  return { turnId, items, indexById, indexBySourceItemId };
}

function updatedTurnDiffs(turnDiffs: ReadonlyMap<string, string>, turnId: string, diff: string): ReadonlyMap<string, string> {
  const next = new Map(turnDiffs);
  if (diff.trim().length > 0) {
    next.set(turnId, diff);
  } else {
    next.delete(turnId);
  }
  return next;
}

function latestTurnId(items: readonly ThreadStreamItem[]): string | null {
  for (const item of [...items].reverse()) {
    if (item.turnId) return item.turnId;
  }
  return null;
}

function turnInitiatorDialogueForTurn(items: readonly ThreadStreamItem[], turnId: string): ThreadStreamDialogueItem | null {
  const roles = threadStreamUserRoles(items);
  const item = items.find((item, index) => item.turnId === turnId && roles[index] === "initiator");
  return item?.kind === "dialogue" ? item : null;
}
