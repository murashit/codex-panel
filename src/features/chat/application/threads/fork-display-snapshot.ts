import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { reconcileTurnSnapshot } from "../../domain/thread-stream/turn-snapshot";
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Matching item identity preserves its variant; history may omit Panel-owned display data, so retain those fields while applying the supplied history fields.
    const mergedItem = { ...displayItem, ...item } as ThreadStreamItem;
    if (item.provenance) return mergedItem;
    const hydratedItem = { ...mergedItem };
    delete hydratedItem.provenance;
    return hydratedItem;
  });
  const pendingItemsByTurn = new Map(
    orderedTurnIds(historyItemsWithDisplayState).map((turnId) => [
      turnId,
      reconcileTurnSnapshot(
        historyItemsWithDisplayState.filter((item) => item.turnId === turnId),
        displayItems.filter((item) => item.turnId === turnId),
      ),
    ]),
  );
  const retainedItems = displayItems.flatMap((item) => {
    if (!item.turnId) return [item];
    const pending = pendingItemsByTurn.get(item.turnId);
    if (!pending) return [item];
    // Keep the key so later display items from this turn are skipped.
    pendingItemsByTurn.set(item.turnId, []);
    return pending;
  });
  const missingTurnItems = [...pendingItemsByTurn.values()].flat();
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
  const turnIds = new Set<string>();
  for (const item of items) {
    if (item.turnId) turnIds.add(item.turnId);
  }
  return [...turnIds];
}
