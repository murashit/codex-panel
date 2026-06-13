import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/viewport";
import { messageStreamStateFromShellState, useChatPanelShellState, type ChatPanelMessageStreamShellState } from "../../ui/shell-state";

export interface ChatPanelMessageStreamRenderer {
  renderState(state: ChatPanelMessageStreamShellState): MessageStreamViewportState;
}

export function ChatPanelMessageStream({ renderer }: { renderer: ChatPanelMessageStreamRenderer }): UiNode {
  const state = messageStreamStateFromShellState(useChatPanelShellState());
  return h(MessageStreamViewport, { state: renderer.renderState(state) });
}
