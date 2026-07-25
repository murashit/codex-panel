import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { selectChatPanelComposer, selectChatPanelThreadStream } from "../../../../src/features/chat/panel/shell/selectors";

export function composerModelFromChatState(state: ChatState) {
  return selectChatPanelComposer(state);
}

export function threadStreamModelFromChatState(state: ChatState) {
  return selectChatPanelThreadStream(state);
}
