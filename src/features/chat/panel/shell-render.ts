import type { ComponentChild as UiNode } from "preact";

import type { ChatStateStore } from "../chat-state";
import { renderChatPanelShell } from "../ui/shell";

export interface ChatShellRenderPort {
  render(root: HTMLElement): void;
}

export function createChatShellRenderPort(
  stateStore: ChatStateStore,
  options: {
    showToolbar: () => boolean;
    toolbarNode: () => UiNode;
    goalNode: () => UiNode;
    messagesNode: () => UiNode;
    composerNode: () => UiNode;
  },
): ChatShellRenderPort {
  return {
    render(root) {
      renderChatPanelShell(root, {
        stateStore,
        showToolbar: options.showToolbar(),
        toolbarNode: options.toolbarNode,
        goalNode: options.goalNode,
        messagesNode: options.messagesNode,
        composerNode: options.composerNode,
      });
    },
  };
}
