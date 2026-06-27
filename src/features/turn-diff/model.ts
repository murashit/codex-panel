export interface TurnDiffViewState {
  threadId: string;
  turnId: string;
  cwd: string | null;
  files: string[];
  diff: string;
}

export type PersistedTurnDiffViewState = Omit<TurnDiffViewState, "diff">;

export function persistedTurnDiffViewState(state: TurnDiffViewState): PersistedTurnDiffViewState {
  return {
    threadId: state.threadId,
    turnId: state.turnId,
    cwd: state.cwd,
    files: [...state.files],
  };
}

export function isPersistedTurnDiffViewState(value: unknown): value is PersistedTurnDiffViewState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedTurnDiffViewState>;
  return (
    typeof record.threadId === "string" &&
    typeof record.turnId === "string" &&
    (typeof record.cwd === "string" || record.cwd === null) &&
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === "string")
  );
}
