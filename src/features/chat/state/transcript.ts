import { upsertDisplayItem } from "./transcript-updates";
import type { DisplayItem } from "../display/types";

export interface ChatTranscriptState {
  displayItems: readonly DisplayItem[];
  turnDiffs: ReadonlyMap<string, string>;
  historyCursor: string | null;
  loadingHistory: boolean;
  reportedLogs: ReadonlySet<string>;
}

export type TranscriptAction =
  | { type: "transcript/item-added"; item: DisplayItem }
  | { type: "transcript/system-item-added"; item: DisplayItem }
  | { type: "transcript/deduped-log-added"; text: string; item: DisplayItem }
  | { type: "transcript/history-loading-set"; loading: boolean }
  | {
      type: "transcript/items-replaced";
      items: readonly DisplayItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
    }
  | { type: "transcript/item-upserted"; item: DisplayItem }
  | { type: "transcript/turn-diff-updated"; turnId: string; diff: string };

export function initialChatTranscriptState(): ChatTranscriptState {
  return {
    displayItems: [],
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  };
}

export function reduceTranscriptSlice(state: ChatTranscriptState, action: TranscriptAction): ChatTranscriptState {
  switch (action.type) {
    case "transcript/item-added":
    case "transcript/system-item-added":
      return patchObject(state, { displayItems: [...state.displayItems, action.item] });
    case "transcript/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchObject(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        displayItems: [...state.displayItems, action.item],
      });
    case "transcript/items-replaced":
      return patchObject(state, {
        displayItems: action.items,
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
      });
    case "transcript/history-loading-set":
      return patchObject(state, { loadingHistory: action.loading });
    case "transcript/item-upserted":
      return patchObject(state, { displayItems: upsertDisplayItem(state.displayItems, action.item) });
    case "transcript/turn-diff-updated":
      return patchObject(state, {
        turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff),
      });
  }
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
  return { ...current, ...patch };
}

function definedPatch<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
