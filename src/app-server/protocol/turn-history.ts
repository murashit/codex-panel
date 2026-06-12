import type { TurnRecord } from "./turn";

export type HistoricalTurn = Pick<TurnRecord, "id" | "items" | "startedAt">;

export interface ThreadTurnsPage {
  data: readonly HistoricalTurn[];
  nextCursor: string | null;
}
