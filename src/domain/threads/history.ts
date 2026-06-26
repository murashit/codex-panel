export interface HistoricalTurn<TItem = unknown> {
  id: string;
  items: readonly TItem[];
  startedAt: number | null;
}

export interface ThreadTurnsPage<TItem = unknown> {
  turns: readonly HistoricalTurn<TItem>[];
  nextCursor: string | null;
}
