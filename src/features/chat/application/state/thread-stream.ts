import {
  streamedItemOutputThreadStreamItem,
  streamedTextThreadStreamItem,
  streamedToolOutputThreadStreamItem,
} from "../../domain/thread-stream/factories/streaming-items";
import { normalizeProposedPlanMarkdown } from "../../domain/thread-stream/format/proposed-plan";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import { threadStreamSemanticClassifications } from "../../domain/thread-stream/semantics/classify";
import { threadStreamIsTurnInitiator } from "../../domain/thread-stream/semantics/predicates";
import { completeReasoningItems, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import { definedPatch, patchObject } from "./patch";

export interface ChatThreadStreamActiveSegment {
  readonly turnId: string | null;
  readonly items: readonly ThreadStreamItem[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly indexBySourceItemId: ReadonlyMap<string, number>;
}

export interface ChatThreadStreamState {
  readonly stableItems: readonly ThreadStreamItem[];
  readonly activeSegment: ChatThreadStreamActiveSegment | null;
  readonly turnDiffs: ReadonlyMap<string, string>;
  readonly historyCursor: string | null;
  readonly loadingHistory: boolean;
  readonly reportedLogs: ReadonlySet<string>;
}

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
    activeSegment: null,
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  };
}

export function threadStreamItems(state: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">): readonly ThreadStreamItem[] {
  if (!state.activeSegment || state.activeSegment.items.length === 0) return state.stableItems;
  return [...state.stableItems, ...state.activeSegment.items];
}

export function threadStreamStableItems(state: Pick<ChatThreadStreamState, "stableItems">): readonly ThreadStreamItem[] {
  return state.stableItems;
}

export function threadStreamActiveItems(state: Pick<ChatThreadStreamState, "activeSegment">): readonly ThreadStreamItem[] {
  return state.activeSegment?.items ?? [];
}

export function threadStreamIsEmpty(state: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">): boolean {
  return state.stableItems.length === 0 && (!state.activeSegment || state.activeSegment.items.length === 0);
}

export function threadStreamTurnsAfterTurnId(
  state: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">,
  turnId: string,
): number | null {
  const turnIds = orderedTurnIds(threadStreamItems(state));
  const index = turnIds.indexOf(turnId);
  return index === -1 ? null : turnIds.length - index - 1;
}

export function threadStreamRollbackCandidate(
  state: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">,
): ThreadStreamRollbackCandidate | null {
  return threadStreamRollbackCandidateFromItems(threadStreamItems(state));
}

export function threadStreamRollbackCandidateFromItems(items: readonly ThreadStreamItem[]): ThreadStreamRollbackCandidate | null {
  const lastTurnId = latestTurnId(items);
  if (!lastTurnId) return null;

  const userMessage = promptMessageForTurn(items, lastTurnId);
  if (!userMessage) return null;

  return {
    turnId: lastTurnId,
    itemId: userMessage.id,
    text: userMessage.copyText ?? userMessage.text,
  };
}

export function threadStreamWithItems(
  state: ChatThreadStreamState,
  items: readonly ThreadStreamItem[],
  patch: Partial<Pick<ChatThreadStreamState, "historyCursor" | "loadingHistory">> = {},
): ChatThreadStreamState {
  return patchObject(state, {
    stableItems: items,
    activeSegment: null,
    ...patch,
  });
}

export function threadStreamWithActiveTurnItems(
  state: ChatThreadStreamState,
  turnId: string,
  items: readonly ThreadStreamItem[],
): ChatThreadStreamState {
  const stableItems = items.filter((item) => item.turnId !== turnId);
  const activeItems = items.filter((item) => item.turnId === turnId);
  return patchObject(state, {
    stableItems,
    activeSegment: activeSegmentFromItems(turnId, activeItems),
  });
}

export function threadStreamStartActiveSegment(
  state: ChatThreadStreamState,
  turnId: string | null,
  items: readonly ThreadStreamItem[],
): ChatThreadStreamState {
  return patchObject(state, { activeSegment: activeSegmentFromItems(turnId, items) });
}

export function reduceThreadStreamSlice(state: ChatThreadStreamState, action: ThreadStreamAction): ChatThreadStreamState {
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
      return threadStreamWithItems(state, action.items, {
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
      });
    case "thread-stream/history-loading-set":
      return patchObject(state, { loadingHistory: action.loading });
    case "thread-stream/item-upserted":
      return upsertThreadStreamItem(state, action.item);
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

function appendThreadStreamItemPatch(state: ChatThreadStreamState, item: ThreadStreamItem): Partial<ChatThreadStreamState> {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return { activeSegment: appendActiveSegmentItem(state.activeSegment, item) };
  }
  return { stableItems: [...state.stableItems, item] };
}

function upsertThreadStreamItem(state: ChatThreadStreamState, item: ThreadStreamItem): ChatThreadStreamState {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return patchObject(state, { activeSegment: upsertActiveSegmentItem(state.activeSegment, item) });
  }
  return patchObject(state, { stableItems: upsertThreadStreamItemById(state.stableItems, item) });
}

function appendAssistantDeltaToThreadStream(
  state: ChatThreadStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  completeReasoning: boolean,
): ChatThreadStreamState {
  const current = completeReasoning ? completeReasoningInThreadStream(state, turnId) : state;
  return updateActiveSegment(current, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        item.kind === "dialogue" && item.dialogueKind === "assistantResponse"
          ? {
              ...item,
              text: `${item.text}${delta}`,
              copyText: `${item.text}${delta}`,
              turnId: item.turnId ?? turnId,
              dialogueState: "streaming",
            }
          : item,
      );
    }
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind: "dialogue",
      dialogueKind: "assistantResponse",
      role: "assistant",
      text: delta,
      copyText: delta,
      turnId,
      sourceItemId,
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      dialogueState: "streaming",
    });
  });
}

function appendPlanDeltaToThreadStream(
  state: ChatThreadStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
): ChatThreadStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => {
        if (item.kind !== "dialogue" || item.role !== "assistant") return item;
        const text = normalizeProposedPlanMarkdown(`${item.text}${delta}`);
        return {
          ...item,
          dialogueKind: "proposedPlan",
          text,
          copyText: text,
          turnId: item.turnId ?? turnId,
          dialogueState: "streaming",
        };
      });
    }
    const text = normalizeProposedPlanMarkdown(delta);
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind: "dialogue",
      dialogueKind: "proposedPlan",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      sourceItemId,
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      dialogueState: "streaming",
    });
  });
}

function appendItemTextToThreadStream(
  state: ChatThreadStreamState,
  sourceItemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ChatThreadStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => appendTextToMatchingStreamItemKind(item, kind, delta));
    }
    return appendActiveSegmentItem(segment, {
      ...streamedTextThreadStreamItem({
        id: sourceItemId,
        kind,
        label,
        delta,
        turnId,
      }),
    });
  });
}

function appendToolOutputToThreadStream(
  state: ChatThreadStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): ChatThreadStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        item.kind === "tool" || item.kind === "hook" || item.kind === "reasoning"
          ? { ...item, output: `${item.output ?? ""}${delta}` }
          : item,
      );
    }
    return appendActiveSegmentItem(
      segment,
      streamedToolOutputThreadStreamItem({
        id: sourceItemId,
        turnId,
        output: delta,
        fallbackLabel,
      }),
    );
  });
}

function appendItemOutputToThreadStream(
  state: ChatThreadStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): ChatThreadStreamState {
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

function completeReasoningInThreadStream(state: ChatThreadStreamState, turnId: string): ChatThreadStreamState {
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
  state: ChatThreadStreamState,
  turnId: string,
  update: (segment: ChatThreadStreamActiveSegment) => ChatThreadStreamActiveSegment,
): ChatThreadStreamState {
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

function appendTextToMatchingStreamItemKind(item: ThreadStreamItem, kind: "tool" | "hook" | "reasoning", delta: string): ThreadStreamItem {
  if (item.kind !== kind) return item;
  return { ...item, text: `${item.text ?? ""}${delta}` };
}

function shouldUseActiveSegment(
  segment: ChatThreadStreamActiveSegment | null,
  item: ThreadStreamItem,
): segment is ChatThreadStreamActiveSegment {
  if (!segment) return false;
  return !item.turnId || !segment.turnId || item.turnId === segment.turnId;
}

function appendActiveSegmentItem(segment: ChatThreadStreamActiveSegment, item: ThreadStreamItem): ChatThreadStreamActiveSegment {
  return activeSegmentFromItems(segment.turnId, [...segment.items, item]);
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

function promptMessageForTurn(items: readonly ThreadStreamItem[], turnId: string): ThreadStreamDialogueItem | null {
  const classification = threadStreamSemanticClassifications(items).find(
    (classification) => classification.item.turnId === turnId && threadStreamIsTurnInitiator(classification),
  );
  const item = classification?.item;
  return item?.kind === "dialogue" ? item : null;
}
