import type { ChatState } from "../../../../src/features/chat/application/state/model";
import { selectChatPanelComposer } from "../../../../src/features/chat/host/composer/view-projection";
import { selectChatPanelThreadStream } from "../../../../src/features/chat/host/thread-stream/view-projection";
import { type ChatSharedDisplayValues, composerSharedValues, threadStreamSharedValues } from "./shared-display-values";

export function composerModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues) {
  return selectChatPanelComposer(state, composerSharedValues(shared));
}

export function threadStreamModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues) {
  return selectChatPanelThreadStream(state, threadStreamSharedValues(shared));
}
