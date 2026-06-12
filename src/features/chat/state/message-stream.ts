import { upsertDisplayItem } from "./message-stream-updates";
import type { DisplayItem } from "../display/types";
import { normalizeProposedPlanMarkdown } from "../display/items/proposed-plan";

export interface ChatMessageStreamActiveSegment {
  turnId: string | null;
  items: readonly DisplayItem[];
  indexById: ReadonlyMap<string, number>;
  indexBySourceItemId: ReadonlyMap<string, number>;
}

export interface ChatMessageStreamState {
  /** Compatibility projection for tests and legacy fixtures. Runtime code should use messageStreamDisplayItems. */
  displayItems: readonly DisplayItem[];
  stableItems: readonly DisplayItem[];
  activeSegment: ChatMessageStreamActiveSegment | null;
  turnDiffs: ReadonlyMap<string, string>;
  historyCursor: string | null;
  loadingHistory: boolean;
  reportedLogs: ReadonlySet<string>;
}

export type MessageStreamAction =
  | { type: "message-stream/item-added"; item: DisplayItem }
  | { type: "message-stream/system-item-added"; item: DisplayItem }
  | { type: "message-stream/deduped-log-added"; text: string; item: DisplayItem }
  | { type: "message-stream/history-loading-set"; loading: boolean }
  | {
      type: "message-stream/items-replaced";
      items: readonly DisplayItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
    }
  | { type: "message-stream/item-upserted"; item: DisplayItem }
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

export function initialChatMessageStreamState(items: readonly DisplayItem[] = []): ChatMessageStreamState {
  return withDisplayItemsAccessor({
    stableItems: items,
    activeSegment: null,
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  });
}

export function messageStreamDisplayItems(state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">): readonly DisplayItem[] {
  const legacyItems = legacyDisplayItems(state);
  if (legacyItems && state.stableItems.length === 0 && (!state.activeSegment || state.activeSegment.items.length === 0)) return legacyItems;
  if (!state.activeSegment || state.activeSegment.items.length === 0) return state.stableItems;
  return [...state.stableItems, ...state.activeSegment.items];
}

export function messageStreamStableItems(state: Pick<ChatMessageStreamState, "stableItems">): readonly DisplayItem[] {
  return state.stableItems;
}

export function messageStreamActiveItems(state: Pick<ChatMessageStreamState, "activeSegment">): readonly DisplayItem[] {
  return state.activeSegment?.items ?? [];
}

export function messageStreamIsEmpty(state: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">): boolean {
  const legacyItems = legacyDisplayItems(state);
  if (legacyItems) return legacyItems.length === 0;
  return state.stableItems.length === 0 && (!state.activeSegment || state.activeSegment.items.length === 0);
}

export function messageStreamWithDisplayItems(
  state: ChatMessageStreamState,
  items: readonly DisplayItem[],
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
  items: readonly DisplayItem[],
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
  items: readonly DisplayItem[],
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
      return messageStreamWithDisplayItems(state, action.items, {
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

function appendMessageStreamItem(state: ChatMessageStreamState, item: DisplayItem): ChatMessageStreamState {
  return patchObject(state, appendMessageStreamItemPatch(state, item));
}

function appendMessageStreamItemPatch(state: ChatMessageStreamState, item: DisplayItem): Partial<ChatMessageStreamState> {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return { activeSegment: appendActiveSegmentItem(state.activeSegment, item) };
  }
  return { stableItems: [...state.stableItems, item] };
}

function upsertMessageStreamItem(state: ChatMessageStreamState, item: DisplayItem): ChatMessageStreamState {
  if (shouldUseActiveSegment(state.activeSegment, item)) {
    return patchObject(state, { activeSegment: upsertActiveSegmentItem(state.activeSegment, item) });
  }
  return patchObject(state, { stableItems: upsertDisplayItem(state.stableItems, item) });
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
      return replaceActiveSegmentItem(segment, index, (item) => ({ ...item, text: `${item.text}${delta}` }));
    }
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind,
      role: "tool",
      text: `${label}: ${delta}`,
      turnId,
      sourceItemId,
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
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind: "tool",
      role: "tool",
      text: "details",
      toolLabel: fallbackLabel,
      turnId,
      sourceItemId,
      output: delta,
    });
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
    return appendActiveSegmentItem(segment, {
      id: sourceItemId,
      kind,
      role: "tool",
      text: fallbackText,
      turnId,
      sourceItemId,
      output: delta,
      ...(kind === "fileChange"
        ? {
            status: "inProgress",
            changes: [],
            executionState: "running",
          }
        : {
            command: fallbackText,
            cwd: "(unknown)",
            status: "running",
            executionState: "running",
          }),
    } as DisplayItem);
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

function completedReasoningItems(items: readonly DisplayItem[], turnId: string): { items: readonly DisplayItem[]; changed: boolean } {
  let changed = false;
  const nextItems: DisplayItem[] = [];
  for (const item of items) {
    if (item.kind !== "reasoning" || item.turnId !== turnId) {
      nextItems.push(item);
    } else {
      changed = true;
      nextItems.push({
        ...item,
        status: "completed",
        executionState: "completed",
      } satisfies DisplayItem);
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
  item: DisplayItem,
): segment is ChatMessageStreamActiveSegment {
  if (!segment) return false;
  return !item.turnId || !segment.turnId || item.turnId === segment.turnId;
}

function appendActiveSegmentItem(segment: ChatMessageStreamActiveSegment, item: DisplayItem): ChatMessageStreamActiveSegment {
  return activeSegmentFromItems(segment.turnId, [...segment.items, item]);
}

function upsertActiveSegmentItem(segment: ChatMessageStreamActiveSegment, item: DisplayItem): ChatMessageStreamActiveSegment {
  const index = segment.indexById.get(item.id);
  if (index === undefined) return appendActiveSegmentItem(segment, item);
  return replaceActiveSegmentItem(segment, index, (previous) => mergeDisplayItem(previous, item));
}

function replaceActiveSegmentItem(
  segment: ChatMessageStreamActiveSegment,
  index: number,
  replacement: (item: DisplayItem) => DisplayItem,
): ChatMessageStreamActiveSegment {
  const previous = segment.items[index];
  if (!previous) return segment;
  const next = replacement(previous);
  if (next === previous) return segment;
  const items = [...segment.items];
  items[index] = next;
  return activeSegmentFromItems(segment.turnId, items);
}

function mergeDisplayItem(previous: DisplayItem, next: DisplayItem): DisplayItem {
  return upsertDisplayItem([previous], next)[0] ?? next;
}

function activeSegmentFromItems(turnId: string | null, items: readonly DisplayItem[]): ChatMessageStreamActiveSegment {
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

function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  const next = { ...current, ...patch };
  return isMessageStreamState(next) ? (withDisplayItemsAccessor(next) as unknown as T) : next;
}

function definedPatch<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}

function isMessageStreamState(value: object): value is ChatMessageStreamState {
  return "stableItems" in value && "activeSegment" in value && "turnDiffs" in value && "reportedLogs" in value;
}

function legacyDisplayItems(state: object): readonly DisplayItem[] | null {
  if (!Object.prototype.propertyIsEnumerable.call(state, "displayItems")) return null;
  const value = (state as { displayItems?: unknown }).displayItems;
  return Array.isArray(value) ? (value as readonly DisplayItem[]) : null;
}

function withDisplayItemsAccessor(state: Omit<ChatMessageStreamState, "displayItems">): ChatMessageStreamState {
  Object.defineProperty(state, "displayItems", {
    configurable: true,
    enumerable: false,
    get() {
      return messageStreamDisplayItems(this as ChatMessageStreamState);
    },
    set(items: readonly DisplayItem[]) {
      (this as ChatMessageStreamState).stableItems = items;
      (this as ChatMessageStreamState).activeSegment = null;
    },
  });
  return state as unknown as ChatMessageStreamState;
}
