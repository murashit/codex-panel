import type { ChatState } from "../../../../src/features/chat/application/state/model";
import { selectChatPanelComposer, selectChatPanelThreadStream } from "../../../../src/features/chat/host/shell/selectors";
import { type ChatSharedDisplayValues, composerSharedValues, threadStreamSharedValues } from "./shared-display-values";

export function composerModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues) {
  return selectChatPanelComposer(state, composerSharedValues(shared));
}

export function threadStreamModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues) {
  return selectChatPanelThreadStream(state, threadStreamSharedValues(shared));
}
