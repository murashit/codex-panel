import type { App, Component } from "obsidian";
import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import { copyTextWithNotice } from "../../../../shared/obsidian/clipboard.obsidian";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { ChatAction } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { ThreadStreamScrollPortBinding } from "../../ui/thread-stream/flow-scroll.measure";
import { renderStreamMarkdown, ThreadStreamMarkdownRenderer } from "../../ui/thread-stream/markdown-renderer.obsidian";
import { ThreadStreamViewport, type ThreadStreamViewportState } from "../../ui/thread-stream/stream-blocks";
import type { ChatPanelThreadStreamModel } from "../shell-selectors";
import { type ChatThreadStreamSurfaceContext, threadStreamSurfaceProjectionFromModel } from "./thread-stream-projection";

export interface ChatPanelThreadStreamPresenter {
  renderState(model: ChatPanelThreadStreamModel): ThreadStreamViewportState;
}

export function ChatPanelThreadStream({
  model,
  presenter,
}: {
  model: ChatPanelThreadStreamModel;
  presenter: ChatPanelThreadStreamPresenter;
}): UiNode {
  return h(ThreadStreamViewport, {
    state: presenter.renderState(model),
    rootAttributes: { "data-codex-panel-shell-region": "thread-stream" },
  });
}

interface ChatThreadStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (itemId: string) => void;
  openThreadInNewView: (threadId: string) => void;
  openTurnDiff: (state: TurnDiffViewState) => void;
}

interface ChatThreadStreamRequests {
  pendingActions: () => PendingRequestBlockActions;
  consumePendingAutoFocus: () => boolean;
}

interface ThreadStreamPresenterObsidianContext {
  app: App;
  owner: Component;
}

interface ThreadStreamPresenterStateContext {
  store: ChatStateStore;
}

interface ThreadStreamPresenterWorkspaceContext {
  vaultPath: string;
}

interface ThreadStreamPresenterScrollContext {
  portBinding: ThreadStreamScrollPortBinding;
  dispose: () => void;
}

interface ThreadStreamPresenterHistoryContext {
  loadOlderTurns: () => void;
}

export interface ThreadStreamPresenterOptions {
  panelId: string;
  obsidian: ThreadStreamPresenterObsidianContext;
  state: ThreadStreamPresenterStateContext;
  workspace: ThreadStreamPresenterWorkspaceContext;
  scroll: ThreadStreamPresenterScrollContext;
  history: ThreadStreamPresenterHistoryContext;
  actions: ChatThreadStreamActions;
  requests: ChatThreadStreamRequests;
}

export class ThreadStreamPresenter {
  private readonly obsidianMarkdownRenderer: ThreadStreamMarkdownRenderer;
  private readonly surfaceContext: ChatThreadStreamSurfaceContext;

  constructor(private readonly options: ThreadStreamPresenterOptions) {
    this.obsidianMarkdownRenderer = new ThreadStreamMarkdownRenderer({
      app: options.obsidian.app,
      owner: options.obsidian.owner,
      vaultPath: options.workspace.vaultPath,
    });
    this.surfaceContext = {
      panelId: options.panelId,
      vaultPath: options.workspace.vaultPath,
      setDisclosureOpen: (bucket, id, open) => {
        this.dispatch({ type: "ui/disclosure-set", bucket, id, open });
      },
      setForkMenuItem: (itemId) => {
        this.dispatch({ type: "ui/thread-stream-fork-menu-set", itemId });
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
      copyDialogueText: (text) => void this.copyDialogueText(text),
      actions: options.actions,
      requests: options.requests,
    };
  }

  renderState(model: ChatPanelThreadStreamModel): ThreadStreamViewportState {
    const projection = threadStreamSurfaceProjectionFromModel(model, this.surfaceContext);

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

  private async copyDialogueText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }
}
