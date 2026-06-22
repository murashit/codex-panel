import { cloneChatState } from "./clone";
import { chatReducer, createChatState, type ChatAction, type ChatState } from "./root-reducer";

export interface ChatStateStore {
  getState(): ChatState;
  dispatch(action: ChatAction): ChatState;
  subscribe(listener: () => void): () => void;
}

export function createChatStateStore(initialState: ChatState = createChatState()): ChatStateStore {
  let current = cloneChatState(initialState);
  const listeners = new Set<() => void>();
  return {
    getState: () => current,
    dispatch(action) {
      const next = chatReducer(current, action);
      if (next === current) return current;
      current = next;
      for (const listener of listeners) listener();
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
