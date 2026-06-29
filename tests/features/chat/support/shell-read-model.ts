import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatPanelShellReadModelBinding } from "../../../../src/features/chat/panel/shell-read-model";

export function composerReadModelFromChatState(state: ChatState) {
  return createChatPanelShellReadModelBinding(state).readModel.composer;
}

export function messageStreamReadModelFromChatState(state: ChatState) {
  return createChatPanelShellReadModelBinding(state).readModel.messageStream;
}
