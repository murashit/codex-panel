import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import {
  composerStateFromShellState,
  createChatPanelShellState,
  messageStreamStateFromShellState,
} from "../../../../src/features/chat/panel/shell-state";

export function composerShellStateFromChatState(state: ChatState): ReturnType<typeof composerStateFromShellState> {
  return composerStateFromShellState(createChatPanelShellState(state));
}

export function messageStreamShellStateFromChatState(state: ChatState): ReturnType<typeof messageStreamStateFromShellState> {
  return messageStreamStateFromShellState(createChatPanelShellState(state));
}
