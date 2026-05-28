import type { ChatState, ChatStateStore } from "./chat-state";
import type { ChatViewRenderScheduleOptions } from "./view-lifecycle";
import { composerSlotSnapshot, messagesSlotSnapshot, toolbarSlotSnapshot } from "./view-snapshot";
import { renderChatPanelShell } from "./ui/shell";

export interface ChatViewRenderControllerHost {
  stateStore: ChatStateStore;
  panelRoot: () => HTMLElement | null;
  connected: () => boolean;
  pendingRequestsSignature: () => string;
  activeComposerThreadName: () => string | null;
  renderToolbar: (toolbar: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
  clearScheduledRender: () => void;
}

export class ChatViewRenderController {
  private shellRenderVersion = 0;

  constructor(private readonly host: ChatViewRenderControllerHost) {}

  render(options: ChatViewRenderScheduleOptions = {}): void {
    this.host.clearScheduledRender();
    const root = this.host.panelRoot();
    if (!root) return;
    if (options.forceSlots) this.shellRenderVersion += 1;
    renderChatPanelShell(root, {
      stateStore: this.host.stateStore,
      renderVersion: this.shellRenderVersion,
      toolbar: { render: this.renderToolbarSlot, snapshot: this.toolbarSnapshot },
      messages: { render: this.renderMessagesSlot, snapshot: this.messagesSnapshot },
      composer: { render: this.renderComposerSlot, snapshot: this.composerSnapshot },
    });
  }

  renderShellSlots(): void {
    this.render({ forceSlots: true });
  }

  private readonly renderToolbarSlot = (toolbar: HTMLElement): void => {
    this.host.renderToolbar(toolbar);
  };

  private readonly renderMessagesSlot = (parent: HTMLElement): void => {
    this.host.renderMessages(parent);
  };

  private readonly renderComposerSlot = (parent: HTMLElement): void => {
    this.host.renderComposer(parent);
  };

  private readonly toolbarSnapshot = (state: ChatState) => toolbarSlotSnapshot(state, this.host.connected());

  private readonly messagesSnapshot = (state: ChatState) => messagesSlotSnapshot(state, this.host.pendingRequestsSignature());

  private readonly composerSnapshot = (state: ChatState) => composerSlotSnapshot(state, this.host.activeComposerThreadName());
}
