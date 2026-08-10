import { reconcileCompletedTurnItems } from "../../domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { ChatThreadStreamViewState } from "../state/thread-stream";
import { threadStreamItems } from "../state/thread-stream";

export type ForkDisplayBoundary =
  | { readonly kind: "latest" }
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

export interface ForkDisplaySnapshot {
  readonly items: readonly ThreadStreamItem[];
  readonly turnDiffs: ReadonlyMap<string, string>;
}

export function captureForkDisplaySnapshot(state: ChatThreadStreamViewState, boundary: ForkDisplayBoundary): ForkDisplaySnapshot {
  const items = threadStreamItems(state);
  const retainedTurnIds = forkDisplayRetainedTurnIds(items, boundary);
  return {
    items: items.filter((item) => item.turnId && retainedTurnIds.has(item.turnId)),
    turnDiffs: new Map([...state.turnDiffs].filter(([turnId]) => retainedTurnIds.has(turnId))),
  };
}

export function reconcileForkDisplayItems(
  displayItems: readonly ThreadStreamItem[],
  historyItems: readonly ThreadStreamItem[],
  options: { readonly missingTurns?: "append" | "prepend" } = {},
): readonly ThreadStreamItem[] {
  const displayItemsById = new Map(displayItems.map((item) => [item.id, item]));
  const displayUserItemsByClientId = new Map(
    displayItems.flatMap((item) =>
      item.kind === "dialogue" && item.role === "user" && item.clientId ? ([[item.clientId, item]] as const) : [],
    ),
  );
  const historyItemsWithDisplayState = historyItems.map((item) => {
    const displayItem =
      displayItemsById.get(item.id) ??
      (item.kind === "dialogue" && item.role === "user" && item.clientId ? displayUserItemsByClientId.get(item.clientId) : undefined);
    if (!displayItem) return item;
    const mergedItem = { ...displayItem, ...item } as ThreadStreamItem;
    if (item.provenance) return mergedItem;
    const hydratedItem = { ...mergedItem };
    delete hydratedItem.provenance;
    return hydratedItem;
  });
  const historyTurnIds = orderedTurnIds(historyItemsWithDisplayState);
  const historyTurnIdSet = new Set(historyTurnIds);
  const reconciledItemsByTurnId = new Map(
    historyTurnIds.map((turnId) => [
      turnId,
      reconcileCompletedTurnItems({
        currentItems: displayItems.filter((item) => item.turnId === turnId),
        completedTurnId: turnId,
        turnItems: historyItemsWithDisplayState.filter((item) => item.turnId === turnId),
      }),
    ]),
  );
  const emittedTurnIds = new Set<string>();
  const retainedItems = displayItems.flatMap((item) => {
    if (!item.turnId || !historyTurnIdSet.has(item.turnId)) return [item];
    if (emittedTurnIds.has(item.turnId)) return [];
    emittedTurnIds.add(item.turnId);
    return reconciledItemsByTurnId.get(item.turnId) ?? [];
  });
  const missingTurnItems = historyTurnIds.flatMap((turnId) => {
    if (emittedTurnIds.has(turnId)) return [];
    return reconciledItemsByTurnId.get(turnId) ?? [];
  });
  return options.missingTurns === "prepend" ? [...missingTurnItems, ...retainedItems] : [...retainedItems, ...missingTurnItems];
}

function forkDisplayRetainedTurnIds(items: readonly ThreadStreamItem[], boundary: ForkDisplayBoundary): ReadonlySet<string> {
  const turnIds = orderedTurnIds(items);
  if (boundary.kind === "latest") return new Set(turnIds);
  const boundaryIndex = turnIds.indexOf(boundary.turnId);
  if (boundaryIndex === -1) return new Set();
  const end = boundary.kind === "through-turn" ? boundaryIndex + 1 : boundaryIndex;
  return new Set(turnIds.slice(0, end));
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
