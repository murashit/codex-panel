import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { ChatThreadStreamViewState } from "../state/thread-stream";
import { threadStreamItems } from "../state/thread-stream";

export type ForkDisplayBoundary =
  | { readonly kind: "latest" }
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

export interface ForkDisplaySnapshot {
  readonly historyCursor?: string | null;
  readonly items: readonly ThreadStreamItem[];
  readonly turnDiffs: ReadonlyMap<string, string>;
}

export function captureForkDisplaySnapshot(state: ChatThreadStreamViewState, boundary: ForkDisplayBoundary): ForkDisplaySnapshot {
  const items = threadStreamItems(state);
  const retainedTurnIds = forkDisplayRetainedTurnIds(items, boundary);
  return {
    items: items.filter((item) => item.turnId && retainedTurnIds.has(item.turnId)),
    historyCursor: boundary.kind === "latest" || items.some((item) => item.turnId === boundary.turnId) ? state.historyCursor : null,
    turnDiffs: new Map([...state.turnDiffs].filter(([turnId]) => retainedTurnIds.has(turnId))),
  };
}

function forkDisplayRetainedTurnIds(items: readonly ThreadStreamItem[], boundary: ForkDisplayBoundary): ReadonlySet<string> {
  const turnIds = [...new Set(items.flatMap((item) => (item.turnId ? [item.turnId] : [])))];
  if (boundary.kind === "latest") return new Set(turnIds);
  const boundaryIndex = turnIds.indexOf(boundary.turnId);
  if (boundaryIndex === -1) return new Set();
  const end = boundary.kind === "through-turn" ? boundaryIndex + 1 : boundaryIndex;
  return new Set(turnIds.slice(0, end));
}
