import type { App, Component } from "obsidian";

import { copyTextWithNotice } from "../../shared/ui/clipboard";
import {
  createMessageStreamContext,
  createMessageStreamContextPort,
  messageStreamBlocks,
  renderMessageStreamBlocks,
  type ChatMessageStreamActionPort,
  type ChatMessageStreamContextPort,
  type ChatMessageStreamRequestPort,
} from "./ui/message-stream";
import type { ComposerBoundaryScrollAction } from "./composer/boundary-scroll";
import { MessageScrollController, type MessageScrollIntent } from "./ui/scroll";
import { MarkdownMessageRenderer } from "./markdown-message-renderer";
import { type ChatAction, type ChatState, type ChatStateStore } from "./chat-state";
import { unmountUiRoot } from "../../shared/ui/ui-root";

export interface ChatMessageRendererObsidianPort {
  app: App;
  owner: Component;
}

export interface ChatMessageRendererStatePort {
  store: ChatStateStore;
}

export interface ChatMessageRendererWorkspacePort {
  vaultPath: string;
}

export interface ChatMessageRendererScrollPort {
  consumeIntent: () => MessageScrollIntent;
}

export interface ChatMessageRendererHistoryPort {
  loadOlderTurns: () => void;
}

export interface ChatMessageRendererOptions {
  obsidian: ChatMessageRendererObsidianPort;
  state: ChatMessageRendererStatePort;
  workspace: ChatMessageRendererWorkspacePort;
  scroll: ChatMessageRendererScrollPort;
  history: ChatMessageRendererHistoryPort;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
}

export class ChatMessageRenderer {
  private messagesEl: HTMLElement | null = null;
  private bottomPinFrame: number | null = null;
  private readonly scrollController: MessageScrollController;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: ChatMessageRendererOptions) {
    this.scrollController = new MessageScrollController({
      messagesPinnedToBottom: () => this.state.ui.messagesPinnedToBottom,
      setMessagesPinnedToBottom: (pinned) => {
        this.dispatch({ type: "ui/messages-pinned-set", pinned });
      },
    });
    this.markdownRenderer = new MarkdownMessageRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
      messagesPinnedToBottom: () => this.state.ui.messagesPinnedToBottom,
      pinMessagesToBottom: (messagesEl) => {
        this.pinMessagesToBottom(messagesEl);
      },
    });
  }

  private get state(): ChatState {
    return this.options.state.store.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.state.store.dispatch(action);
  }

  render(messagesEl: HTMLElement): void {
    const state = this.state;
    this.messagesEl = messagesEl;
    const scrollPlan = this.scrollController.prepareRender(messagesEl, this.options.scroll.consumeIntent());
    const blocks = messageStreamBlocks(createMessageStreamContext(state, this.messageStreamPort()));
    renderMessageStreamBlocks(messagesEl, blocks);
    this.scrollController.completeRender(scrollPlan);
  }

  private messageStreamPort(): ChatMessageStreamContextPort {
    return createMessageStreamContextPort({
      vaultPath: this.options.workspace.vaultPath,
      state: () => this.state,
      dispatch: (action) => {
        this.dispatch(action);
      },
      loadOlderTurns: () => {
        this.options.history.loadOlderTurns();
      },
      renderMarkdown: (element, text) => {
        this.markdownRenderer.renderMarkdown(element, text);
      },
      copyMessageText: (text) => void this.copyMessageText(text),
      actions: this.options.actions,
      requests: this.options.requests,
    });
  }

  dispose(): void {
    this.cancelBottomPinFrame();
    if (this.messagesEl) {
      unmountUiRoot(this.messagesEl);
    }
    this.scrollController.dispose();
    this.messagesEl = null;
  }

  scrollFromComposer(action: ComposerBoundaryScrollAction): void {
    if (action.amount === "page") {
      this.scrollController.scrollByPage(action.direction);
    } else {
      this.scrollController.scrollByTextLines(action.direction);
    }
  }

  forceMessagesToBottom(): void {
    this.scrollController.pinToBottom(this.messagesEl);
    this.scheduleBottomPinAfterLayout();
  }

  correctMessagesAfterLayoutChange(): void {
    this.scrollController.correctAfterLayoutChange();
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }

  private pinMessagesToBottom(messagesEl: HTMLElement): void {
    this.scrollController.pinToBottom(messagesEl);
  }

  private scheduleBottomPinAfterLayout(): void {
    const messagesEl = this.messagesEl;
    if (!messagesEl || this.bottomPinFrame !== null) return;

    this.bottomPinFrame = messagesEl.win.requestAnimationFrame(() => {
      this.bottomPinFrame = null;
      if (!this.state.ui.messagesPinnedToBottom) return;
      this.scrollController.pinToBottom(this.messagesEl);
    });
  }

  private cancelBottomPinFrame(): void {
    const messagesEl = this.messagesEl;
    if (!messagesEl || this.bottomPinFrame === null) return;
    messagesEl.win.cancelAnimationFrame(this.bottomPinFrame);
    this.bottomPinFrame = null;
  }
}
