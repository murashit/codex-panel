import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import { copyTextWithNotice } from "../../../../shared/obsidian/clipboard.obsidian";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { ChatAction } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { MessageStreamScrollControllerBinding } from "../../ui/message-stream/flow-scroll.measure";
import { MarkdownMessageRenderer, renderStreamMarkdown } from "../../ui/message-stream/markdown-renderer.obsidian";
import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/stream-blocks";
import type { ChatPanelMessageStreamReadModel } from "../shell-read-model";
import {
  type ChatMessageStreamSurfaceContext,
  createMessageStreamSurfaceContext,
  messageStreamSurfaceProjectionFromModel,
} from "./message-stream-projection";

export interface ChatPanelMessageStreamPresenter {
  renderState(model: ChatPanelMessageStreamReadModel): MessageStreamViewportState;
}

export function ChatPanelMessageStream({
  model,
  presenter,
}: {
  model: ChatPanelMessageStreamReadModel;
  presenter: ChatPanelMessageStreamPresenter;
}): UiNode {
  return h(MessageStreamViewport, {
    state: presenter.renderState(model),
    rootAttributes: { "data-codex-panel-shell-region": "message-stream" },
  });
}

interface ChatMessageStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (itemId: string) => void;
  openTurnDiff: (state: TurnDiffViewState) => void;
}

interface ChatMessageStreamRequests {
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
  controller: MessageStreamScrollControllerBinding;
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
  private readonly obsidianMarkdownRenderer: MarkdownMessageRenderer;

  constructor(private readonly options: MessageStreamPresenterOptions) {
    this.obsidianMarkdownRenderer = new MarkdownMessageRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
    });
  }

  private dispatch(action: ChatAction): void {
    this.options.state.store.dispatch(action);
  }

  renderState(model: ChatPanelMessageStreamReadModel): MessageStreamViewportState {
    return this.renderStateFor(model);
  }

  private renderStateFor(model: ChatPanelMessageStreamReadModel): MessageStreamViewportState {
    const projection = messageStreamSurfaceProjectionFromModel(model, this.messageStreamSurfaceContext());

    return {
      blocks: projection.blocks,
      context: projection.context,
      scrollController: this.options.scroll.controller,
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
      renderObsidianMarkdown: (element, text) => {
        this.obsidianMarkdownRenderer.renderObsidianMarkdown(element, text);
      },
      renderStreamMarkdown: (element, text) => {
        renderStreamMarkdown(element, text, {
          app: this.options.obsidian.app,
          vaultPath: this.options.workspace.vaultPath,
        });
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
