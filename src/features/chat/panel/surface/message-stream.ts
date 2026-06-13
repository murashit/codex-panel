import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/viewport";
import { messageStreamStateFromShellState, useChatPanelShellState, type ChatPanelMessageStreamShellState } from "../../ui/shell-state";

export interface ChatPanelMessageStreamPresenter {
  renderState(state: ChatPanelMessageStreamShellState): MessageStreamViewportState;
}

export function ChatPanelMessageStream({ presenter }: { presenter: ChatPanelMessageStreamPresenter }): UiNode {
  const state = messageStreamStateFromShellState(useChatPanelShellState());
  return h(MessageStreamViewport, {
    state: presenter.renderState(state),
    rootAttributes: { "data-codex-panel-shell-region": "message-stream" },
  });
}
