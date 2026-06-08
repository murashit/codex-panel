import type { App, Component } from "obsidian";

import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import { unmountUiRoot } from "../../../../shared/ui/ui-root";
import type { ChatAction, ChatState, ChatStateStore } from "../../chat-state";
import type { ComposerBoundaryScrollAction } from "../../composer/boundary-scroll";
import { MessageStreamVirtualizer, type MessageStreamScrollIntent } from "../message-virtualizer";
import { messageStreamBlocks } from "./blocks";
import {
  createMessageStreamContext,
  type ChatMessageStreamActionPort,
  type ChatMessageStreamContextPort,
  type ChatMessageStreamRequestPort,
} from "./context-builder";
import { createMessageStreamContextPort } from "./context-port";
import { MarkdownMessageRenderer } from "./markdown-renderer";
import { renderMessageStreamBlocks } from "./render";

interface ChatMessageRendererObsidianPort {
  app: App;
  owner: Component;
}

interface ChatMessageRendererStatePort {
  store: ChatStateStore;
}

interface ChatMessageRendererWorkspacePort {
  vaultPath: string;
}

interface ChatMessageRendererScrollPort {
  consumeIntent: () => MessageStreamScrollIntent;
}

interface ChatMessageRendererHistoryPort {
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
  private readonly messageVirtualizer: MessageStreamVirtualizer;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: ChatMessageRendererOptions) {
    this.messageVirtualizer = new MessageStreamVirtualizer();
    this.markdownRenderer = new MarkdownMessageRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
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
    const blocks = messageStreamBlocks(createMessageStreamContext(state, this.messageStreamPort()));
    const scrollPlan = this.messageVirtualizer.prepareRender(messagesEl, this.options.scroll.consumeIntent(), blocks);
    renderMessageStreamBlocks(messagesEl, blocks, this.messageVirtualizer);
    this.messageVirtualizer.completeRender(scrollPlan);
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
    if (this.messagesEl) {
      unmountUiRoot(this.messagesEl);
    }
    this.messageVirtualizer.dispose();
    this.messagesEl = null;
  }

  scrollFromComposer(action: ComposerBoundaryScrollAction): void {
    if (action.amount === "page") {
      this.messageVirtualizer.scrollByPage(action.direction);
    } else {
      this.messageVirtualizer.scrollByTextLines(action.direction);
    }
  }

  forceMessagesToBottom(): void {
    this.messageVirtualizer.pinToBottom(this.messagesEl);
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }
}
