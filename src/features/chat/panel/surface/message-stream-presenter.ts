import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { App, Component } from "obsidian";
import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import type { ChatAction, ChatStateStore } from "../../state/reducer";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";
import { MarkdownMessageRenderer } from "../../ui/message-stream/markdown-renderer";
import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/viewport";
import type { MessageStreamItem } from "../../domain/message-stream/model/items";
import { messageStreamBlocks } from "../../ui/message-stream/stream-blocks";
import { messageStreamStateFromShellState, useChatPanelShellState, type ChatPanelMessageStreamShellState } from "../../ui/shell-state";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../conversation/pending-requests/view-model";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";
import {
  createMessageStreamSurfaceContext,
  messageStreamSurfaceProjectionFromState,
  type ChatMessageStreamSurfaceContext,
} from "./message-stream-projection";

export interface ChatPanelMessageStreamPresenter {
  renderState(state: ChatPanelMessageStreamShellState): MessageStreamViewportState;
}

export function ChatPanelMessageStream({ presenter }: { presenter: ChatPanelMessageStreamPresenter }): UiNode {
  const state = messageStreamStateFromShellState(useChatPanelShellState());
  return h(MessageStreamViewport, {
    state: presenter.renderState(state),
    rootAttributes: { "data-codex-panel-shell-region": "message-stream" },
  });
}

interface ChatMessageStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (item: MessageStreamItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
}

interface ChatMessageStreamRequests {
  pendingSignature: () => string;
  pendingSnapshot: () => PendingRequestBlockSnapshot;
  pendingActions: () => PendingRequestBlockActions;
  consumePendingAutoFocus: () => boolean;
}

interface MessageStreamPresenterObsidianContext {
  app: App;
  owner: Component;
}

interface MessageStreamPresenterStateContext {
  store: ChatStateStore;
}

interface MessageStreamPresenterWorkspaceContext {
  vaultPath: string;
}

interface MessageStreamPresenterScrollContext {
  consumeIntent: () => MessageStreamScrollIntent;
  registerVirtualizer: (virtualizer: MessageStreamVirtualizerHandle) => () => void;
  dispose: () => void;
}

interface MessageStreamPresenterHistoryContext {
  loadOlderTurns: () => void;
}

export interface MessageStreamPresenterOptions {
  obsidian: MessageStreamPresenterObsidianContext;
  state: MessageStreamPresenterStateContext;
  workspace: MessageStreamPresenterWorkspaceContext;
  scroll: MessageStreamPresenterScrollContext;
  history: MessageStreamPresenterHistoryContext;
  actions: ChatMessageStreamActions;
  requests: ChatMessageStreamRequests;
}

export class MessageStreamPresenter {
  private readonly markdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: MessageStreamPresenterOptions) {
    this.markdownRenderer = new MarkdownMessageRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
    });
  }

  private dispatch(action: ChatAction): void {
    this.options.state.store.dispatch(action);
  }

  renderState(state: ChatPanelMessageStreamShellState): MessageStreamViewportState {
    return this.renderStateFor(state);
  }

  private renderStateFor(state: ChatPanelMessageStreamShellState): MessageStreamViewportState {
    const projection = messageStreamSurfaceProjectionFromState(state, this.messageStreamSurfaceContext());

    return {
      blocks: messageStreamBlocks(projection.blocks, projection.context),
      consumeScrollIntent: this.options.scroll.consumeIntent,
      registerVirtualizer: this.options.scroll.registerVirtualizer,
    };
  }

  private messageStreamSurfaceContext(): ChatMessageStreamSurfaceContext {
    return createMessageStreamSurfaceContext({
      vaultPath: this.options.workspace.vaultPath,
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
    this.options.scroll.dispose();
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }
}
