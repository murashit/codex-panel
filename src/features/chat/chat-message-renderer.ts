import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import type { DisplayItem } from "./display/types";
import { copyTextWithNotice } from "../../shared/ui/clipboard";
import { messageStreamBlocks, renderMessageStreamBlocks } from "./ui/message-stream";
import type { ComposerBoundaryScrollAction } from "./composer/boundary-scroll";
import { MessageScrollController, type MessageScrollIntent } from "./ui/scroll";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { MarkdownMessageRenderer } from "./markdown-message-renderer";
import { forkCandidatesFromItems, isForkCandidateItem } from "./fork";
import { isRollbackCandidateItem, rollbackCandidateFromItems } from "./rollback";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "./chat-state";
import { implementPlanCandidateFromState } from "./plan-implementation";
import { unmountUiRoot } from "../../shared/ui/ui-root";

export interface ChatMessageRendererOptions {
  app: App;
  owner: Component;
  stateStore: ChatStateStore;
  vaultPath: string;
  consumeScrollIntent: () => MessageScrollIntent;
  loadOlderTurns: () => void;
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature: () => string;
  renderPendingRequests: () => UiNode;
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
      app: options.app,
      owner: options.owner,
      vaultPath: options.vaultPath,
      messagesPinnedToBottom: () => this.state.ui.messagesPinnedToBottom,
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
    const rollbackCandidate = busy ? null : rollbackCandidateFromItems(state.transcript.displayItems);
    const forkCandidates = busy ? [] : forkCandidatesFromItems(state.transcript.displayItems);
    const implementPlanCandidate = implementPlanCandidateFromState(state);

    const blocks = messageStreamBlocks({
      activeThreadId: state.activeThread.id,
      turnLifecycle: state.turn.lifecycle,
      historyCursor: state.transcript.historyCursor,
      loadingHistory: state.transcript.loadingHistory,
      displayItems: state.transcript.displayItems,
      turnDiffs: state.transcript.turnDiffs,
      workspaceRoot: state.activeThread.cwd ?? this.options.vaultPath,
      openDetails: state.ui.openDetails,
      onDetailsToggle: (key, open) => {
        this.setOpenDetail(key, open);
      },
      loadOlderTurns: () => {
        this.options.loadOlderTurns();
      },
      renderMarkdown: (element, text) => {
        this.markdownRenderer.renderMarkdown(element, text);
      },
      copyText: (text) => void this.copyMessageText(text),
      canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
      onImplementPlanItem: (item) => {
        this.options.implementPlan(item);
      },
      canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
      onRollbackItem: () => {
        if (state.activeThread.id) this.options.rollbackThread(state.activeThread.id);
      },
      canForkItem: (item: DisplayItem) => isForkCandidateItem(item, forkCandidates),
      onForkItem: (item, archiveSource) => {
        if (state.activeThread.id && item.turnId) this.options.forkThreadFromTurn(state.activeThread.id, item.turnId, archiveSource);
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

  private setOpenDetail(key: string, open: boolean): void {
    if (open && key.startsWith("message:fork-actions:")) {
      for (const openKey of this.state.ui.openDetails) {
        if (openKey.startsWith("message:fork-actions:") && openKey !== key) {
          this.dispatch({ type: "ui/detail-open-set", key: openKey, open: false });
        }
      }
    }
    this.dispatch({ type: "ui/detail-open-set", key, open });
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

export { implementPlanCandidateFromState };
