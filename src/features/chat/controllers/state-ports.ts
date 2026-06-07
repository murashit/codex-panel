import type { ChatStateStore } from "../chat-state";
import { composerSlotSnapshot, goalSlotSnapshot, messagesSlotSnapshot, toolbarSlotSnapshot } from "../panel/snapshot";
import { renderChatPanelShell } from "../ui/shell";

export interface ChatShellRenderPort {
  render(
    root: HTMLElement,
    renderVersion: number,
    slots: {
      renderToolbar: (toolbar: HTMLElement) => void;
      renderGoal: (goal: HTMLElement) => void;
      renderMessages: (parent: HTMLElement) => void;
      renderComposer: (parent: HTMLElement) => void;
    },
  ): void;
}

export function createChatShellRenderPort(
  stateStore: ChatStateStore,
  options: {
    connected: () => boolean;
    showToolbar: () => boolean;
    pendingRequestsSignature: () => string;
    activeComposerThreadName: () => string | null;
  },
): ChatShellRenderPort {
  return {
    render(root, renderVersion, slots) {
      renderChatPanelShell(root, {
        stateStore,
        renderVersion,
        showToolbar: options.showToolbar(),
        toolbar: { render: slots.renderToolbar, snapshot: (state) => toolbarSlotSnapshot(state, options.connected()) },
        goal: { render: slots.renderGoal, snapshot: goalSlotSnapshot },
        messages: {
          render: slots.renderMessages,
          snapshot: (state) => messagesSlotSnapshot(state, options.pendingRequestsSignature()),
        },
        composer: {
          render: slots.renderComposer,
          snapshot: (state) => composerSlotSnapshot(state, options.activeComposerThreadName()),
        },
      });
    },
  };
}
