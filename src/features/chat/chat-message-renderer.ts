import type { App, Component } from "obsidian";
import type { ReactNode } from "react";

import type { DisplayItem } from "./display/types";
import { copyTextWithNotice } from "../../shared/ui/clipboard";
import { messageStreamBlocks, renderMessageStreamBlocks } from "./ui/message-stream";
import { MessageScrollController, type MessageScrollIntent } from "./ui/scroll";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { MarkdownMessageRenderer } from "./markdown-message-renderer";
import { isRollbackCandidateItem, rollbackCandidateFromItems } from "./rollback";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "./chat-state";
import { implementPlanCandidateFromState } from "./plan-implementation";
import { unmountReactRoot } from "../../shared/ui/react-root";

export interface ChatMessageRendererOptions {
  app: App;
  owner: Component;
  stateStore: ChatStateStore;
  vaultPath: string;
  consumeScrollIntent: () => MessageScrollIntent;
  loadOlderTurns: () => void;
  rollbackThread: (threadId: string) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature: () => string;
  renderPendingRequests: () => ReactNode;
}

export class ChatMessageRenderer {
  private messagesEl: HTMLElement | null = null;
  private readonly scrollController: MessageScrollController;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: ChatMessageRendererOptions) {
    this.scrollController = new MessageScrollController({
      messagesPinnedToBottom: () => this.state.messagesPinnedToBottom,
      setMessagesPinnedToBottom: (pinned) => {
        this.dispatch({ type: "ui/messages-pinned-set", pinned });
      },
    });
    this.markdownRenderer = new MarkdownMessageRenderer({
      app: options.app,
      owner: options.owner,
      vaultPath: options.vaultPath,
      messagesPinnedToBottom: () => this.state.messagesPinnedToBottom,
      pinMessagesToBottom: (messagesEl) => {
        this.pinMessagesToBottom(messagesEl);
      },
    });
  }

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  render(messagesEl: HTMLElement): void {
    const state = this.state;
    this.messagesEl = messagesEl;
    const scrollPlan = this.scrollController.prepareRender(messagesEl, this.options.consumeScrollIntent());
    const busy = chatTurnBusy(state);
    const rollbackCandidate = busy ? null : rollbackCandidateFromItems(state.displayItems);
    const implementPlanCandidate = implementPlanCandidateFromState(state);

    const blocks = messageStreamBlocks({
      activeThreadId: state.activeThreadId,
      turnLifecycle: state.turnLifecycle,
      historyCursor: state.historyCursor,
      loadingHistory: state.loadingHistory,
      displayItems: state.displayItems,
      turnDiffs: state.turnDiffs,
      workspaceRoot: state.activeThreadCwd ?? this.options.vaultPath,
      openDetails: state.openDetails,
      onDetailsToggle: (key, open) => {
        this.setOpenDetail(key, open);
      },
      loadOlderTurns: () => {
        this.options.loadOlderTurns();
      },
      renderMarkdown: (element, text) => {
        this.markdownRenderer.renderMarkdown(element, text);
      },
      renderTextWithWikiLinks: (element, text) => {
        this.markdownRenderer.renderTextWithWikiLinks(element, text);
      },
      copyText: (text) => void this.copyMessageText(text),
      canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
      onImplementPlanItem: (item) => {
        this.options.implementPlan(item);
      },
      canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
      onRollbackItem: () => {
        if (state.activeThreadId) this.options.rollbackThread(state.activeThreadId);
      },
      openTurnDiff: (turnDiffState) => {
        this.options.openTurnDiff(turnDiffState);
      },
      pendingRequestsSignature: this.options.pendingRequestsSignature(),
      renderPendingRequests: () => this.options.renderPendingRequests(),
    });
    renderMessageStreamBlocks(messagesEl, blocks);
    this.scrollController.completeRender(scrollPlan);
  }

  dispose(): void {
    if (this.messagesEl) {
      unmountReactRoot(this.messagesEl);
    }
    this.scrollController.dispose();
    this.messagesEl = null;
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }

  private pinMessagesToBottom(messagesEl: HTMLElement): void {
    this.scrollController.pinToBottom(messagesEl);
  }

  private setOpenDetail(key: string, open: boolean): void {
    this.dispatch({ type: "ui/detail-open-set", key, open });
  }
}

export { implementPlanCandidateFromState };
