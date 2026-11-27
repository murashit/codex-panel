import type { ThreadStreamItem } from "./items";
import { isOptimisticUserDialogue, matchesOptimisticUserDialogue } from "./local-dialogue-ids";
import { reconcileTurnSnapshot } from "./turn-snapshot";

interface ThreadTurnSnapshot {
  readonly id: string;
  readonly items: readonly ThreadStreamItem[];
}

export interface ThreadHistoryPage {
  readonly turns: readonly ThreadTurnSnapshot[];
  readonly nextCursor: string | null;
}

interface HistoryTurnRows {
  turn: ThreadTurnSnapshot;
  display: ThreadStreamItem[];
  live: ThreadStreamItem[];
}

export function reconcileHistoryItems(
  displayItems: readonly ThreadStreamItem[],
  turns: readonly ThreadTurnSnapshot[],
  liveItems: readonly ThreadStreamItem[] = [],
  older = false,
  unscopedTurnId?: (item: ThreadStreamItem) => string | null,
): readonly ThreadStreamItem[] {
  if (!displayItems.length && !liveItems.length) return turns.flatMap((turn) => turn.items);
  const page = new Map<string, HistoryTurnRows>();
  for (const turn of turns) page.set(turn.id, { turn, display: [], live: [] });
  const pageTurn = (item: ThreadStreamItem) => {
    const turnId = item.turnId ?? unscopedTurnId?.(item);
    if (turnId) return page.get(turnId);
    if (!isOptimisticUserDialogue(item)) return undefined;
    const turn = turns.find((candidate) => candidate.items.some((observed) => matchesOptimisticUserDialogue(item, observed)));
    return turn && page.get(turn.id);
  };
  for (const item of displayItems) pageTurn(item)?.display.push(item);
  const otherLiveItems = new Map<string, ThreadStreamItem>();
  let preceding: HistoryTurnRows | undefined;
  let unscoped: ThreadStreamItem[] = [];
  for (const item of liveItems) {
    const group = pageTurn(item);
    if (!group && !item.turnId) {
      unscoped.push(item);
      continue;
    }
    // Completion clears the active segment. Its unscoped notices still sit between rows of the same turn.
    if (group && group === preceding) group.live.push(...unscoped);
    else for (const row of unscoped) otherLiveItems.set(row.id, row);
    unscoped = [];
    if (group) group.live.push(item);
    else otherLiveItems.set(item.id, item);
    preceding = group;
  }
  for (const row of unscoped) otherLiveItems.set(row.id, row);

  const reconcile = ({ turn, display, live }: HistoryTurnRows) => reconcileTurnSnapshot(turn.items, display, live);
  const retained = displayItems.flatMap((item) => {
    const group = pageTurn(item);
    if (group) return group.display[0] === item ? reconcile(group) : [];
    const updated = otherLiveItems.get(item.id) ?? item;
    otherLiveItems.delete(item.id);
    return [updated];
  });
  const newTurns = [...page.values()].filter((group) => !group.display.length).flatMap(reconcile);
  return older ? [...newTurns, ...retained, ...otherLiveItems.values()] : [...retained, ...newTurns, ...otherLiveItems.values()];
}
