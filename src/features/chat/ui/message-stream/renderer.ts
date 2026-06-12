import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../../state/reducer";
import type { ComposerBoundaryScrollAction } from "../../conversation/composer/boundary-scroll";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "./virtualizer";
import type { ChatMessageStreamActionPort, ChatMessageStreamContextPort, ChatMessageStreamRequestPort } from "./ports";
import { createMessageStreamContextPort } from "./ports";
import { MarkdownMessageRenderer } from "./markdown-renderer";
import { messageStreamViewportNode, type MessageStreamViewportState } from "./viewport";
import type { DisplayItem } from "../../display/types";
import { implementPlanCandidateFromState } from "../../state/selectors";
import { messageStreamActiveItems, messageStreamDisplayItems, messageStreamStableItems } from "../../state/message-stream";
import {
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
  rollbackCandidateFromItems,
} from "../../display/item-actions";
import { messageStreamBlocks } from "./stream-blocks";
import type { MessageStreamContext } from "./context";

interface MessageStreamRendererObsidianPort {
  app: App;
  owner: Component;
}

interface MessageStreamRendererStatePort {
  store: ChatStateStore;
}

interface MessageStreamRendererWorkspacePort {
  vaultPath: string;
}

interface MessageStreamRendererScrollPort {
  consumeIntent: () => MessageStreamScrollIntent;
}

interface MessageStreamRendererHistoryPort {
  loadOlderTurns: () => void;
}

export interface MessageStreamRendererOptions {
  obsidian: MessageStreamRendererObsidianPort;
  state: MessageStreamRendererStatePort;
  workspace: MessageStreamRendererWorkspacePort;
  scroll: MessageStreamRendererScrollPort;
  history: MessageStreamRendererHistoryPort;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
}

export class MessageStreamRenderer {
  private messageVirtualizer: MessageStreamVirtualizerHandle | null = null;
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: MessageStreamRendererOptions) {
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
    return messageStreamViewportNode(this.renderStateFor(state));
  }

  private renderStateFor(state: ChatState): MessageStreamViewportState {
    return {
      blocks: messageStreamBlocks(this.messageStreamContext(state, this.messageStreamPort())),
      consumeScrollIntent: this.options.scroll.consumeIntent,
      registerVirtualizer: this.registerVirtualizer,
    };
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

  private messageStreamContext(state: ChatState, port: ChatMessageStreamContextPort): MessageStreamContext {
    const busy = chatTurnBusy(state);
    const displayItems = messageStreamDisplayItems(state.messageStream);
    const rollbackCandidate = busy ? null : rollbackCandidateFromItems(displayItems);
    const forkCandidates = busy ? [] : forkCandidatesFromItems(displayItems);
    const implementPlanCandidate = implementPlanCandidateFromState(state);

    return {
      activeThreadId: state.activeThread.id,
      turnLifecycle: state.turn.lifecycle,
      historyCursor: state.messageStream.historyCursor,
      loadingHistory: state.messageStream.loadingHistory,
      displayItems,
      stableItems: messageStreamStableItems(state.messageStream),
      activeItems: messageStreamActiveItems(state.messageStream),
      turnDiffs: state.messageStream.turnDiffs,
      workspaceRoot: state.activeThread.cwd ?? port.vaultPath,
      openDetails: state.ui.openDetails,
      onDetailsToggle: port.setOpenDetail,
      loadOlderTurns: port.loadOlderTurns,
      renderMarkdown: port.renderMarkdown,
      copyText: port.copyMessageText,
      canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
      onImplementPlanItem: (item) => {
        port.actions.implementPlan(item);
      },
      canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
      onRollbackItem: () => {
        if (state.activeThread.id) port.actions.rollbackThread(state.activeThread.id);
      },
      canForkItem: (item: DisplayItem) => isForkCandidateItem(item, forkCandidates),
      onForkItem: (item, archiveSource) => {
        if (state.activeThread.id && item.turnId) {
          port.actions.forkThreadFromTurn(state.activeThread.id, item.turnId, archiveSource);
        }
      },
      openTurnDiff: (turnDiffState) => {
        port.actions.openTurnDiff(turnDiffState);
      },
      pendingRequests: {
        signature: port.requests.pendingSignature(),
        snapshot: port.requests.pendingSnapshot,
        actions: port.requests.pendingActions,
        consumeAutoFocus: port.requests.consumePendingAutoFocus,
      },
    };
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

  forceMessageStreamToBottom(): void {
    this.messageVirtualizer?.pinToBottom();
  }

  repinMessageStreamToBottomIfPinned(): void {
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
