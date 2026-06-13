import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { App, Component } from "obsidian";
import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import {
  chatTurnBusy,
  type ChatAction,
  type ChatDisclosureBucket,
  type ChatDisclosureUiState,
  type ChatStateStore,
} from "../../state/reducer";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";
import { MarkdownMessageRenderer } from "../../ui/message-stream/markdown-renderer";
import { MessageStreamViewport, type MessageStreamViewportState } from "../../ui/message-stream/viewport";
import type { MessageStreamItem } from "../../message-stream/items";
import { implementPlanCandidateFromState } from "../../state/selectors";
import { type ForkCandidate, forkCandidatesFromItems, isForkCandidateItem, isRollbackCandidateItem } from "../../message-stream/selectors";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidate,
  messageStreamStableItems,
  type MessageStreamRollbackCandidate,
} from "../../state/message-stream";
import { messageStreamBlocks } from "../../ui/message-stream/stream-blocks";
import type { MessageStreamContext } from "../../ui/message-stream/context";
import { messageStreamStateFromShellState, useChatPanelShellState, type ChatPanelMessageStreamShellState } from "../../ui/shell-state";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../conversation/pending-requests/view-model";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";

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

export interface ChatMessageStreamSurfaceContext {
  vaultPath: string;
  setDisclosureOpen: (bucket: ChatDisclosureBucket, id: string, open: boolean) => void;
  setForkActionsItem: (itemId: string | null) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActions;
  requests: ChatMessageStreamRequests;
}

interface MessageStreamSurfaceContextOptions {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActions;
  requests: ChatMessageStreamRequests;
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

export interface MessageStreamStateProjection {
  activeThreadId: string | null;
  turnLifecycle: ChatPanelMessageStreamShellState["turn"]["lifecycle"];
  historyCursor: string | null;
  loadingHistory: boolean;
  items: readonly MessageStreamItem[];
  stableItems: readonly MessageStreamItem[];
  activeItems: readonly MessageStreamItem[];
  turnDiffs: ChatPanelMessageStreamShellState["messageStream"]["turnDiffs"];
  workspaceRoot: string;
  disclosures: ChatDisclosureUiState;
  forkActionsItemId: string | null;
  implementPlanCandidate: MessageStreamItem | null;
  rollbackCandidate: MessageStreamRollbackCandidate | null;
  forkCandidates: readonly ForkCandidate[];
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
    return {
      blocks: messageStreamBlocks(messageStreamContextFromState(state, this.messageStreamSurfaceContext())),
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

export function messageStreamContextFromState(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamContext {
  const projection = messageStreamStateProjection(state, context.vaultPath);

  return {
    activeThreadId: projection.activeThreadId,
    turnLifecycle: projection.turnLifecycle,
    historyCursor: projection.historyCursor,
    loadingHistory: projection.loadingHistory,
    items: projection.items,
    stableItems: projection.stableItems,
    activeItems: projection.activeItems,
    turnDiffs: projection.turnDiffs,
    workspaceRoot: projection.workspaceRoot,
    disclosures: projection.disclosures,
    onDisclosureToggle: context.setDisclosureOpen,
    forkActionsItemId: projection.forkActionsItemId,
    onForkActionsToggle: context.setForkActionsItem,
    loadOlderTurns: context.loadOlderTurns,
    renderMarkdown: context.renderMarkdown,
    copyText: context.copyMessageText,
    canImplementPlanItem: (item: MessageStreamItem) => item.id === projection.implementPlanCandidate?.id,
    onImplementPlanItem: (item) => {
      context.actions.implementPlan(item);
    },
    canRollbackItem: (item: MessageStreamItem) => isRollbackCandidateItem(item, projection.rollbackCandidate),
    onRollbackItem: () => {
      if (projection.activeThreadId) context.actions.rollbackThread(projection.activeThreadId);
    },
    canForkItem: (item: MessageStreamItem) => isForkCandidateItem(item, projection.forkCandidates),
    onForkItem: (item, archiveSource) => {
      if (projection.activeThreadId && item.turnId) {
        context.actions.forkThreadFromTurn(projection.activeThreadId, item.turnId, archiveSource);
      }
    },
    openTurnDiff: (turnDiffState) => {
      context.actions.openTurnDiff(turnDiffState);
    },
    pendingRequests: {
      signature: context.requests.pendingSignature(),
      snapshot: context.requests.pendingSnapshot,
      actions: context.requests.pendingActions,
      consumeAutoFocus: context.requests.consumePendingAutoFocus,
    },
  };
}

export function messageStreamStateProjection(state: ChatPanelMessageStreamShellState, vaultPath: string): MessageStreamStateProjection {
  const busy = chatTurnBusy(state);
  const items = messageStreamItems(state.messageStream);
  const rollbackCandidate = busy ? null : messageStreamRollbackCandidate(state.messageStream);
  const forkCandidates = busy ? [] : forkCandidatesFromItems(items);
  const implementPlanCandidate = implementPlanCandidateFromState(state);

  return {
    activeThreadId: state.activeThread.id,
    turnLifecycle: state.turn.lifecycle,
    historyCursor: state.messageStream.historyCursor,
    loadingHistory: state.messageStream.loadingHistory,
    items,
    stableItems: messageStreamStableItems(state.messageStream),
    activeItems: messageStreamActiveItems(state.messageStream),
    turnDiffs: state.messageStream.turnDiffs,
    workspaceRoot: state.activeThread.cwd ?? vaultPath,
    disclosures: state.ui.disclosures,
    forkActionsItemId: state.ui.messageActions.forkActionsItemId,
    implementPlanCandidate,
    rollbackCandidate,
    forkCandidates,
  };
}

function createMessageStreamSurfaceContext(options: MessageStreamSurfaceContextOptions): ChatMessageStreamSurfaceContext {
  return {
    vaultPath: options.vaultPath,
    setDisclosureOpen: (bucket, id, open) => {
      options.dispatch({ type: "ui/disclosure-set", bucket, id, open });
    },
    setForkActionsItem: (itemId) => {
      options.dispatch({ type: "ui/message-fork-actions-set", itemId });
    },
    loadOlderTurns: options.loadOlderTurns,
    renderMarkdown: options.renderMarkdown,
    copyMessageText: options.copyMessageText,
    actions: options.actions,
    requests: options.requests,
  };
}
