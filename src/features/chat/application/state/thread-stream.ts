import { threadStreamUserRoles } from "../../domain/thread-stream/conversation";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  appendAssistantStreamingDelta,
  appendPlanStreamingDelta,
  appendTextStreamingDelta,
  appendToolOutputStreamingDelta,
  streamedItemOutputThreadStreamItem,
} from "../../domain/thread-stream/streaming-items";
import { completeReasoningItems, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
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
      type: "thread-stream/items-replaced";
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
    case "thread-stream/items-replaced":
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

export function threadStreamTurnsAfterTurnId(state: ChatThreadStreamViewState, turnId: string): number | null {
  const turnIds = orderedTurnIds(threadStreamItems(state));
  const index = turnIds.indexOf(turnId);
  return index === -1 ? null : turnIds.length - index - 1;
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
    case "thread-stream/items-replaced":
      return patchObject(state, {
        stableItems: action.items,
        activeSegment: null,
        pendingSteers: [],
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
    case "thread-stream/assistant-delta-appended":
      return appendAssistantDeltaToThreadStream(state, action.itemId, action.turnId, action.delta, action.completeReasoning ?? false);
    case "thread-stream/plan-delta-appended":
      return appendPlanDeltaToThreadStream(state, action.itemId, action.turnId, action.delta);
    case "thread-stream/item-text-appended":
      return appendItemTextToThreadStream(state, action.itemId, action.turnId, action.label, action.delta, action.kind);
    case "thread-stream/tool-output-appended":
      return appendToolOutputToThreadStream(state, action.itemId, action.turnId, action.delta, action.fallbackLabel);
    case "thread-stream/item-output-appended":
      return appendItemOutputToThreadStream(state, action.itemId, action.turnId, action.delta, action.kind, action.fallbackText);
    case "thread-stream/turn-diff-updated":
      return patchObject(state, {
        turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff),
      });
  }
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

function appendAssistantDeltaToThreadStream(
  state: ChatThreadStreamViewState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  completeReasoning: boolean,
): ChatThreadStreamViewState {
  const current = completeReasoning ? completeReasoningInThreadStream(state, turnId) : state;
  return updateActiveSegment(current, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => appendAssistantStreamingDelta(item, sourceItemId, turnId, delta));
    }
    return appendActiveSegmentItem(segment, appendAssistantStreamingDelta(null, sourceItemId, turnId, delta));
  });
}

function appendPlanDeltaToThreadStream(
  state: ChatThreadStreamViewState,
  sourceItemId: string,
  turnId: string,
  delta: string,
): ChatThreadStreamViewState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => appendPlanStreamingDelta(item, sourceItemId, turnId, delta));
    }
    return appendActiveSegmentItem(segment, appendPlanStreamingDelta(null, sourceItemId, turnId, delta));
  });
}

function appendItemTextToThreadStream(
  state: ChatThreadStreamViewState,
  sourceItemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ChatThreadStreamViewState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => appendTextStreamingDelta(item, sourceItemId, turnId, label, delta, kind));
    }
    return appendActiveSegmentItem(segment, appendTextStreamingDelta(null, sourceItemId, turnId, label, delta, kind));
  });
}

function appendToolOutputToThreadStream(
  state: ChatThreadStreamViewState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): ChatThreadStreamViewState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        appendToolOutputStreamingDelta(item, sourceItemId, turnId, delta, fallbackLabel, { allowReasoning: true }),
      );
    }
    return appendActiveSegmentItem(segment, appendToolOutputStreamingDelta(null, sourceItemId, turnId, delta, fallbackLabel));
  });
}

function appendItemOutputToThreadStream(
  state: ChatThreadStreamViewState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): ChatThreadStreamViewState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        item.kind === "command" || item.kind === "fileChange" ? { ...item, output: `${item.output ?? ""}${delta}` } : item,
      );
    }
    return appendActiveSegmentItem(
      segment,
      streamedItemOutputThreadStreamItem({
        id: sourceItemId,
        kind,
        turnId,
        output: delta,
        fallbackText,
      }),
    );
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
  return replaceActiveSegmentItem(segment, index, (previous) => upsertThreadStreamItemById([previous], item)[0] ?? item);
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

function orderedTurnIds(items: readonly ThreadStreamItem[]): string[] {
  const turnIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.turnId || seen.has(item.turnId)) continue;
    seen.add(item.turnId);
    turnIds.push(item.turnId);
  }
  return turnIds;
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
