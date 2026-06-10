import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import type { ChatAction, ChatState, ChatStateStore } from "../../chat-state";
import type { ComposerBoundaryScrollAction } from "../../composer/boundary-scroll";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../message-virtualizer";
import type { ChatMessageStreamActionPort, ChatMessageStreamContextPort, ChatMessageStreamRequestPort } from "./context-builder";
import { createMessageStreamContextPort } from "./context-port";
import { MarkdownMessageRenderer } from "./markdown-renderer";
import { messageStreamBlocksNode, type MessageStreamRenderState } from "./render";
import { createMessageStreamRenderState } from "./render-state";

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
  private messageVirtualizer: MessageStreamVirtualizerHandle | null = null;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: ChatMessageRendererOptions) {
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

  renderNode(): UiNode {
    const state = this.state;
    return messageStreamBlocksNode(this.renderStateFor(state));
  }

  private renderStateFor(state: ChatState): MessageStreamRenderState {
    return createMessageStreamRenderState({
      state,
      contextPort: this.messageStreamPort(),
      consumeScrollIntent: this.options.scroll.consumeIntent,
      registerVirtualizer: this.registerVirtualizer,
    });
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
    this.messageVirtualizer = null;
  }

  scrollFromComposer(action: ComposerBoundaryScrollAction): void {
    if (action.amount === "page") {
      this.messageVirtualizer?.scrollByPage(action.direction);
    } else {
      this.messageVirtualizer?.scrollByTextLines(action.direction);
    }
  }

  forceMessagesToBottom(): void {
    this.messageVirtualizer?.pinToBottom();
  }

  repinMessagesToBottomIfPinned(): void {
    this.messageVirtualizer?.repinToBottomIfPinned();
  }

  private readonly registerVirtualizer = (virtualizer: MessageStreamVirtualizerHandle): (() => void) => {
    this.messageVirtualizer = virtualizer;
    return () => {
      if (this.messageVirtualizer === virtualizer) this.messageVirtualizer = null;
    };
  };

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }
}
