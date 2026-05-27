import type { App, Component } from "obsidian";
import type { ReactNode } from "react";

import type { DisplayItem } from "./display/types";
import { copyTextWithNotice } from "../../shared/ui/clipboard";
import { messageRenderBlocks, renderMessageRenderBlocks } from "./ui/message-stream";
import { bottomScrollTop, captureScrollAnchor, isNearScrollBottom, restoreScrollAnchor } from "./ui/scroll";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { MarkdownMessageRenderer } from "./markdown-message-renderer";
import { isRollbackCandidateItem, rollbackCandidateFromItems } from "./rollback";
import type { ChatAction, ChatState, ChatStateStore } from "./chat-state";
import { unmountReactRoot } from "../../shared/ui/react-root";

export interface ChatMessageRendererOptions {
  app: App;
  owner: Component;
  stateStore: ChatStateStore;
  vaultPath: string;
  blockSignatures: Map<string, string>;
  consumeScrollIntent: () => ChatMessageScrollIntent;
  loadOlderTurns: () => void;
  rollbackThread: (threadId: string) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature: () => string;
  renderPendingRequests: () => ReactNode;
}

export type ChatMessageScrollIntent = "auto" | "force-bottom" | "preserve";

export class ChatMessageRenderer {
  private renderGeneration = 0;
  private messagesEl: HTMLElement | null = null;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: ChatMessageRendererOptions) {
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
    const generation = ++this.renderGeneration;
    const state = this.state;
    this.messagesEl = messagesEl;
    messagesEl.onscroll = () => {
      this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
    };
    const scrollIntent = this.options.consumeScrollIntent();
    const shouldPreserveScroll = scrollIntent === "preserve";
    const wasNearBottom = shouldPreserveScroll ? false : isNearScrollBottom(messagesEl);
    const shouldScrollToBottom =
      !shouldPreserveScroll && (scrollIntent === "force-bottom" || state.messagesPinnedToBottom || wasNearBottom);
    const scrollAnchor = shouldScrollToBottom ? null : captureScrollAnchor(messagesEl);
    this.dispatch({ type: "ui/messages-pinned-set", pinned: shouldScrollToBottom });
    const rollbackCandidate = state.busy ? null : rollbackCandidateFromItems(state.displayItems);
    const implementPlanCandidate = implementPlanCandidateFromState(state);

    const blocks = messageRenderBlocks({
      activeThreadId: state.activeThreadId,
      activeTurnId: state.activeTurnId,
      historyCursor: state.historyCursor,
      loadingHistory: state.loadingHistory,
      busy: state.busy,
      displayItems: state.displayItems,
      turnDiffs: state.turnDiffs,
      workspaceRoot: state.activeThreadCwd ?? this.options.vaultPath,
      openDetails: state.openDetails,
      onDetailsToggle: (key, open) => {
        this.setOpenDetail(key, open);
        messagesEl.win.requestAnimationFrame(() => {
          this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
        });
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
    renderMessageRenderBlocks(messagesEl, blocks, this.options.blockSignatures);

    messagesEl.win.requestAnimationFrame(() => {
      if (generation !== this.renderGeneration) return;
      if (shouldScrollToBottom) {
        if (!this.state.messagesPinnedToBottom) return;
        this.pinMessagesToBottom(messagesEl);
      } else {
        restoreScrollAnchor(messagesEl, scrollAnchor);
        this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
      }
    });
  }

  dispose(): void {
    this.renderGeneration += 1;
    if (this.messagesEl) {
      this.messagesEl.onscroll = null;
      unmountReactRoot(this.messagesEl);
    }
    this.messagesEl = null;
    this.options.blockSignatures.clear();
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }

  private pinMessagesToBottom(messagesEl: HTMLElement): void {
    messagesEl.scrollTop = bottomScrollTop(messagesEl);
    this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
  }

  private setOpenDetail(key: string, open: boolean): void {
    this.dispatch({ type: "ui/detail-open-set", key, open });
  }
}

export function implementPlanCandidateFromState(
  state: Pick<ChatState, "activeThreadId" | "busy" | "composerDraft" | "requestedCollaborationMode" | "displayItems">,
): DisplayItem | null {
  if (!state.activeThreadId || state.busy || state.composerDraft.trim().length > 0 || state.requestedCollaborationMode !== "plan") {
    return null;
  }
  return (
    [...state.displayItems].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ??
    null
  );
}
