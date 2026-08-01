import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { selectChatPanelComposer, selectChatPanelThreadStream } from "../../../../src/features/chat/host/shell/selectors";
import { type ChatSharedDisplayValues, composerSharedValues, threadStreamSharedValues } from "./shared-display-values";
import { sharedResourcesForChatState } from "./state";

export function composerModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues = sharedResourcesForChatState(state)) {
  return selectChatPanelComposer(state, composerSharedValues(shared));
}

export function threadStreamModelFromChatState(state: ChatState, shared: ChatSharedDisplayValues = sharedResourcesForChatState(state)) {
  return selectChatPanelThreadStream(state, threadStreamSharedValues(shared));
}
