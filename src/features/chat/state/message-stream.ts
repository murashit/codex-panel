import { upsertMessageStreamItemById } from "../domain/message-stream/operations/updates";
import type { MessageStreamItem, MessageStreamMessageItem } from "../domain/message-stream/model/items";
import { normalizeProposedPlanMarkdown } from "../domain/message-stream/format/proposed-plan";
import { messageStreamIsTurnInitiator, messageStreamSemanticClassifications } from "../domain/message-stream/semantics";
import {
  streamedItemOutputMessageStreamItem,
  streamedTextMessageStreamItem,
  streamedToolOutputMessageStreamItem,
} from "../domain/message-stream/factories/streaming-items";

export interface ChatMessageStreamActiveSegment {
  turnId: string | null;
  items: readonly MessageStreamItem[];
  indexById: ReadonlyMap<string, number>;
  indexBySourceItemId: ReadonlyMap<string, number>;
}

export interface ChatMessageStreamState {
  stableItems: readonly MessageStreamItem[];
  activeSegment: ChatMessageStreamActiveSegment | null;
  turnDiffs: ReadonlyMap<string, string>;
  historyCursor: string | null;
  loadingHistory: boolean;
  reportedLogs: ReadonlySet<string>;
}

export interface MessageStreamRollbackCandidate {
  turnId: string;
  itemId: string;
  text: string;
}

export type MessageStreamAction =
  | { type: "message-stream/item-added"; item: MessageStreamItem }
  | { type: "message-stream/system-item-added"; item: MessageStreamItem }
  | { type: "message-stream/deduped-log-added"; text: string; item: MessageStreamItem }
  | { type: "message-stream/history-loading-set"; loading: boolean }
  | {
      type: "message-stream/items-replaced";
      items: readonly MessageStreamItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
    }
  | { type: "message-stream/item-upserted"; item: MessageStreamItem }
  | { type: "message-stream/reasoning-completed"; turnId: string }
  | { type: "message-stream/assistant-delta-appended"; itemId: string; turnId: string; delta: string; completeReasoning?: boolean }
  | { type: "message-stream/plan-delta-appended"; itemId: string; turnId: string; delta: string }
  | {
      type: "message-stream/item-text-appended";
      itemId: string;
      turnId: string;
      label: string;
      delta: string;
      kind: "tool" | "hook" | "reasoning";
    }
  | {
      type: "message-stream/tool-output-appended";
      itemId: string;
      turnId: string;
      delta: string;
      fallbackLabel: string;
    }
  | {
      type: "message-stream/item-output-appended";
      itemId: string;
      turnId: string;
      delta: string;
      kind: "command" | "fileChange";
      fallbackText: string;
    }
  | { type: "message-stream/turn-diff-updated"; turnId: string; diff: string };

export function initialChatMessageStreamState(items: readonly MessageStreamItem[] = []): ChatMessageStreamState {
  return {
    stableItems: items,
    activeSegment: null,
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  };
}

export function messageStreamItems(state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">): readonly MessageStreamItem[] {
  if (!state.activeSegment || state.activeSegment.items.length === 0) return state.stableItems;
  return [...state.stableItems, ...state.activeSegment.items];
}

export function messageStreamStableItems(state: Pick<ChatMessageStreamState, "stableItems">): readonly MessageStreamItem[] {
  return state.stableItems;
}

export function messageStreamActiveItems(state: Pick<ChatMessageStreamState, "activeSegment">): readonly MessageStreamItem[] {
  return state.activeSegment?.items ?? [];
}

export function messageStreamIsEmpty(state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">): boolean {
  return state.stableItems.length === 0 && (!state.activeSegment || state.activeSegment.items.length === 0);
}

export function messageStreamTurnIds(state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">): string[] {
  return orderedTurnIds(messageStreamItems(state));
}

export function messageStreamTurnsAfterTurnId(
  state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">,
  turnId: string,
): number | null {
  const turnIds = messageStreamTurnIds(state);
  const index = turnIds.indexOf(turnId);
  return index === -1 ? null : turnIds.length - index - 1;
}

export function messageStreamRollbackCandidate(
  state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">,
): MessageStreamRollbackCandidate | null {
  const items = messageStreamItems(state);
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

export function messageStreamWithItems(
  state: ChatMessageStreamState,
  items: readonly MessageStreamItem[],
  patch: Partial<Pick<ChatMessageStreamState, "historyCursor" | "loadingHistory">> = {},
): ChatMessageStreamState {
  return patchObject(state, {
    stableItems: items,
    activeSegment: null,
    ...patch,
  });
}

export function messageStreamWithActiveTurnItems(
  state: ChatMessageStreamState,
  turnId: string,
  items: readonly MessageStreamItem[],
): ChatMessageStreamState {
  const stableItems = items.filter((item) => item.turnId !== turnId);
  const activeItems = items.filter((item) => item.turnId === turnId);
  return patchObject(state, {
    stableItems,
    activeSegment: activeSegmentFromItems(turnId, activeItems),
  });
}

export function messageStreamStartActiveSegment(
  state: ChatMessageStreamState,
  turnId: string | null,
  items: readonly MessageStreamItem[],
): ChatMessageStreamState {
  return patchObject(state, { activeSegment: activeSegmentFromItems(turnId, items) });
}

export function reduceMessageStreamSlice(state: ChatMessageStreamState, action: MessageStreamAction): ChatMessageStreamState {
  switch (action.type) {
    case "message-stream/item-added":
    case "message-stream/system-item-added":
      return appendMessageStreamItem(state, action.item);
    case "message-stream/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchObject(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        ...appendMessageStreamItemPatch(state, action.item),
      });
    case "message-stream/items-replaced":
      return messageStreamWithItems(state, action.items, {
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
      });
    case "message-stream/history-loading-set":
      return patchObject(state, { loadingHistory: action.loading });
    case "message-stream/item-upserted":
      return upsertMessageStreamItem(state, action.item);
    case "message-stream/reasoning-completed":
      return completeReasoningInMessageStream(state, action.turnId);
    case "message-stream/assistant-delta-appended":
      return appendAssistantDeltaToMessageStream(state, action.itemId, action.turnId, action.delta, action.completeReasoning ?? false);
    case "message-stream/plan-delta-appended":
      return appendPlanDeltaToMessageStream(state, action.itemId, action.turnId, action.delta);
    case "message-stream/item-text-appended":
      return appendItemTextToMessageStream(state, action.itemId, action.turnId, action.label, action.delta, action.kind);
    case "message-stream/tool-output-appended":
      return appendToolOutputToMessageStream(state, action.itemId, action.turnId, action.delta, action.fallbackLabel);
    case "message-stream/item-output-appended":
      return appendItemOutputToMessageStream(state, action.itemId, action.turnId, action.delta, action.kind, action.fallbackText);
    case "message-stream/turn-diff-updated":
      return patchObject(state, {
        turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff),
      });
  }
}

function appendMessageStreamItem(state: ChatMessageStreamState, item: MessageStreamItem): ChatMessageStreamState {
  return patchObject(state, appendMessageStreamItemPatch(state, item));
}

function appendMessageStreamItemPatch(state: ChatMessageStreamState, item: MessageStreamItem): Partial<ChatMessageStreamState> {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return { activeSegment: appendActiveSegmentItem(state.activeSegment, item) };
  }
  return { stableItems: [...state.stableItems, item] };
}

function upsertMessageStreamItem(state: ChatMessageStreamState, item: MessageStreamItem): ChatMessageStreamState {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return patchObject(state, { activeSegment: upsertActiveSegmentItem(state.activeSegment, item) });
  }
  return patchObject(state, { stableItems: upsertMessageStreamItemById(state.stableItems, item) });
}

function appendAssistantDeltaToMessageStream(
  state: ChatMessageStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  completeReasoning: boolean,
): ChatMessageStreamState {
  const current = completeReasoning ? completeReasoningInMessageStream(state, turnId) : state;
  return updateActiveSegment(current, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        item.kind === "message" && item.messageKind === "assistantResponse"
          ? {
              ...item,
              text: `${item.text}${delta}`,
              copyText: `${item.text}${delta}`,
              turnId: item.turnId ?? turnId,
              messageState: "streaming",
            }
          : item,
      );
    }
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind: "message",
      messageKind: "assistantResponse",
      role: "assistant",
      text: delta,
      copyText: delta,
      turnId,
      sourceItemId,
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      messageState: "streaming",
    });
  });
}

function appendPlanDeltaToMessageStream(
  state: ChatMessageStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
): ChatMessageStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => {
        if (item.kind !== "message" || item.role !== "assistant") return item;
        const text = normalizeProposedPlanMarkdown(`${item.text}${delta}`);
        return {
          ...item,
          messageKind: "proposedPlan",
          text,
          copyText: text,
          turnId: item.turnId ?? turnId,
          messageState: "streaming",
        };
      });
    }
    const text = normalizeProposedPlanMarkdown(delta);
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind: "message",
      messageKind: "proposedPlan",
      role: "assistant",
      text,
      copyText: text,
      turnId,
      sourceItemId,
      provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId },
      messageState: "streaming",
    });
  });
}

function appendItemTextToMessageStream(
  state: ChatMessageStreamState,
  sourceItemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ChatMessageStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) => ({ ...item, text: `${"text" in item ? item.text : ""}${delta}` }));
    }
    return appendActiveSegmentItem(segment, {
      ...streamedTextMessageStreamItem({
        id: sourceItemId,
        kind,
        label,
        delta,
        turnId,
      }),
    });
  });
}

function appendToolOutputToMessageStream(
  state: ChatMessageStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
): ChatMessageStreamState {
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
      streamedToolOutputMessageStreamItem({
        id: sourceItemId,
        turnId,
        output: delta,
        fallbackLabel,
      }),
    );
  });
}

function appendItemOutputToMessageStream(
  state: ChatMessageStreamState,
  sourceItemId: string,
  turnId: string,
  delta: string,
  kind: "command" | "fileChange",
  fallbackText: string,
): ChatMessageStreamState {
  return updateActiveSegment(state, turnId, (segment) => {
    const index = segment.indexBySourceItemId.get(sourceItemId);
    if (index !== undefined) {
      return replaceActiveSegmentItem(segment, index, (item) =>
        item.kind === "command" || item.kind === "fileChange" ? { ...item, output: `${item.output ?? ""}${delta}` } : item,
      );
    }
    return appendActiveSegmentItem(
      segment,
      streamedItemOutputMessageStreamItem({
        id: sourceItemId,
        kind,
        turnId,
        output: delta,
        fallbackText,
      }),
    );
  });
}

function completeReasoningInMessageStream(state: ChatMessageStreamState, turnId: string): ChatMessageStreamState {
  const stableUpdate = completedReasoningItems(state.stableItems, turnId);
  const activeSegment = state.activeSegment;

  if (activeSegment?.turnId !== turnId) {
    return stableUpdate.changed ? patchObject(state, { stableItems: stableUpdate.items }) : state;
  }

  const activeUpdate = completedReasoningItems(activeSegment.items, turnId);

  return stableUpdate.changed || activeUpdate.changed
    ? patchObject(state, {
        stableItems: stableUpdate.items,
        activeSegment: activeUpdate.changed ? activeSegmentFromItems(activeSegment.turnId, activeUpdate.items) : activeSegment,
      })
    : state;
}

function completedReasoningItems(
  items: readonly MessageStreamItem[],
  turnId: string,
): { items: readonly MessageStreamItem[]; changed: boolean } {
  let changed = false;
  const nextItems: MessageStreamItem[] = [];
  for (const item of items) {
    if (item.kind !== "reasoning" || item.turnId !== turnId) {
      nextItems.push(item);
    } else {
      changed = true;
      nextItems.push({
        ...item,
        status: "completed",
        executionState: "completed",
      } satisfies MessageStreamItem);
    }
  }
  return { items: changed ? nextItems : items, changed };
}

function updateActiveSegment(
  state: ChatMessageStreamState,
  turnId: string,
  update: (segment: ChatMessageStreamActiveSegment) => ChatMessageStreamActiveSegment,
): ChatMessageStreamState {
  const segment = state.activeSegment?.turnId === turnId ? state.activeSegment : activeSegmentFromItems(turnId, []);
  return patchObject(state, { activeSegment: update(segment) });
}

function shouldUseActiveSegment(
  segment: ChatMessageStreamActiveSegment | null,
  item: MessageStreamItem,
): segment is ChatMessageStreamActiveSegment {
  if (!segment) return false;
  return !item.turnId || !segment.turnId || item.turnId === segment.turnId;
}

function appendActiveSegmentItem(segment: ChatMessageStreamActiveSegment, item: MessageStreamItem): ChatMessageStreamActiveSegment {
  return activeSegmentFromItems(segment.turnId, [...segment.items, item]);
}

function upsertActiveSegmentItem(segment: ChatMessageStreamActiveSegment, item: MessageStreamItem): ChatMessageStreamActiveSegment {
  const index = segment.indexById.get(item.id);
  if (index === undefined) return appendActiveSegmentItem(segment, item);
  return replaceActiveSegmentItem(segment, index, (previous) => mergeMessageStreamItem(previous, item));
}

function replaceActiveSegmentItem(
  segment: ChatMessageStreamActiveSegment,
  index: number,
  replacement: (item: MessageStreamItem) => MessageStreamItem,
): ChatMessageStreamActiveSegment {
  const previous = segment.items[index];
  if (!previous) return segment;
  const next = replacement(previous);
  if (next === previous) return segment;
  const items = [...segment.items];
  items[index] = next;
  return activeSegmentFromItems(segment.turnId, items);
}

function mergeMessageStreamItem(previous: MessageStreamItem, next: MessageStreamItem): MessageStreamItem {
  return upsertMessageStreamItemById([previous], next)[0] ?? next;
}

function activeSegmentFromItems(turnId: string | null, items: readonly MessageStreamItem[]): ChatMessageStreamActiveSegment {
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

function orderedTurnIds(items: readonly MessageStreamItem[]): string[] {
  const turnIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.turnId || seen.has(item.turnId)) continue;
    seen.add(item.turnId);
    turnIds.push(item.turnId);
  }
  return turnIds;
}

function latestTurnId(items: readonly MessageStreamItem[]): string | null {
  for (const item of [...items].reverse()) {
    if (item.turnId) return item.turnId;
  }
  return null;
}

function promptMessageForTurn(items: readonly MessageStreamItem[], turnId: string): MessageStreamMessageItem | null {
  const classification = messageStreamSemanticClassifications(items).find(
    (classification) => classification.item.turnId === turnId && messageStreamIsTurnInitiator(classification),
  );
  const item = classification?.item;
  return item?.kind === "message" ? item : null;
}

function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  return { ...current, ...patch };
}

function definedPatch<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
