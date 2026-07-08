import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import { copyTextWithNotice } from "../../../../shared/obsidian/clipboard.obsidian";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { ChatAction } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { MessageStreamScrollPortBinding } from "../../ui/message-stream/flow-scroll.measure";
import { MarkdownMessageRenderer, renderStreamMarkdown } from "../../ui/message-stream/markdown-renderer.obsidian";
import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/stream-blocks";
import type { ChatPanelMessageStreamReadModel } from "../shell-read-model";
import { type ChatMessageStreamSurfaceContext, messageStreamSurfaceProjectionFromModel } from "./message-stream-projection";

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
  openThreadInNewView: (threadId: string) => void;
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
  portBinding: MessageStreamScrollPortBinding;
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
  private readonly surfaceContext: ChatMessageStreamSurfaceContext;

  constructor(private readonly options: MessageStreamPresenterOptions) {
    this.obsidianMarkdownRenderer = new MarkdownMessageRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
    });
    this.surfaceContext = {
      vaultPath: options.workspace.vaultPath,
      setDisclosureOpen: (bucket, id, open) => {
        this.dispatch({ type: "ui/disclosure-set", bucket, id, open });
      },
      setForkMenuItem: (itemId) => {
        this.dispatch({ type: "ui/message-fork-menu-set", itemId });
      },
      loadOlderTurns: () => {
        options.history.loadOlderTurns();
      },
      renderObsidianMarkdown: (element, text) => {
        this.obsidianMarkdownRenderer.renderObsidianMarkdown(element, text);
      },
      renderStreamMarkdown: (element, text) => {
        renderStreamMarkdown(element, text, {
          app: options.obsidian.app,
          vaultPath: options.workspace.vaultPath,
        });
      },
      copyMessageText: (text) => void this.copyMessageText(text),
      actions: options.actions,
      requests: options.requests,
    };
  }

  renderState(model: ChatPanelMessageStreamReadModel): MessageStreamViewportState {
    const projection = messageStreamSurfaceProjectionFromModel(model, this.surfaceContext);

    return {
      blocks: projection.blocks,
      context: projection.context,
      scrollPortBinding: this.options.scroll.portBinding,
    };
  }

  private dispatch(action: ChatAction): void {
    this.options.state.store.dispatch(action);
  }

  dispose(): void {
    this.options.scroll.dispose();
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }
}
