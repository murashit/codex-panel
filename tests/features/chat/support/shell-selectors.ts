import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { selectChatPanelComposer, selectChatPanelThreadStream } from "../../../../src/features/chat/panel/shell/selectors";
import type { ChatSharedResources } from "../../../../src/features/chat/panel/shell/shared-resources";
import { sharedResourcesForChatState } from "./state";

export function composerModelFromChatState(state: ChatState, shared: ChatSharedResources = sharedResourcesForChatState(state)) {
  return selectChatPanelComposer(state, shared);
}

export function threadStreamModelFromChatState(state: ChatState, shared: ChatSharedResources = sharedResourcesForChatState(state)) {
  return selectChatPanelThreadStream(state, shared);
}
