export interface ToolbarArchiveConfirmState {
  get: () => string | null;
  set: (threadId: string | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createToolbarArchiveConfirmState(): ToolbarArchiveConfirmState {
  let threadId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => threadId,
    set: (nextThreadId) => {
      if (threadId === nextThreadId) return;
      threadId = nextThreadId;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
