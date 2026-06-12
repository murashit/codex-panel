export interface ChatTurnDiffViewState {
  threadId: string;
  turnId: string;
  cwd: string | null;
  files: string[];
  diff: string;
}

export type PersistedChatTurnDiffViewState = Omit<ChatTurnDiffViewState, "diff">;

export function persistedChatTurnDiffViewState(state: ChatTurnDiffViewState): PersistedChatTurnDiffViewState {
  return {
    threadId: state.threadId,
    turnId: state.turnId,
    cwd: state.cwd,
    files: [...state.files],
  };
}

export function isPersistedChatTurnDiffViewState(value: unknown): value is PersistedChatTurnDiffViewState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedChatTurnDiffViewState>;
  return (
    typeof record.threadId === "string" &&
    typeof record.turnId === "string" &&
    (typeof record.cwd === "string" || record.cwd === null) &&
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === "string")
  );
}
