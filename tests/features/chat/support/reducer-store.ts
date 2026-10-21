import type { ChatState } from "../../../../src/features/chat/application/state/model";
import { type ChatAction, chatReducer } from "../../../../src/features/chat/application/state/reducer";
import type { ChatStateStore } from "../../../../src/features/chat/application/state/store";

// For direct handler/projection tests: dispatch updates state without notifying subscribers.
export function reducerStoreFixture(state: ChatState): ChatStateStore {
  let current = state;
  return {
    getState: () => current,
    dispatch(action: ChatAction) {
      current = chatReducer(current, action);
      return current;
    },
    subscribe: () => () => undefined,
  };
}
