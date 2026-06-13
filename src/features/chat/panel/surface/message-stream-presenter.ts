import type { App, Component } from "obsidian";
import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import { chatTurnBusy, type ChatAction, type ChatDisclosureUiState, type ChatStateStore } from "../../state/reducer";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";
import type { ChatMessageStreamActions, ChatMessageStreamRequests, ChatMessageStreamSurfaceContext } from "./message-stream-context";
import { createMessageStreamSurfaceContext } from "./message-stream-context";
import { MarkdownMessageRenderer } from "../../ui/message-stream/markdown-renderer";
import type { MessageStreamViewportState } from "../../ui/message-stream/viewport";
import type { DisplayItem } from "../../display/types";
import { implementPlanCandidateFromState } from "../../state/selectors";
import { messageStreamActiveItems, messageStreamDisplayItems, messageStreamStableItems } from "../../state/message-stream";
import {
  type ForkCandidate,
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
  type RollbackCandidate,
  rollbackCandidateFromItems,
} from "../../display/item-actions";
import { messageStreamBlocks } from "../../ui/message-stream/stream-blocks";
import type { MessageStreamContext } from "../../ui/message-stream/context";
import type { ChatPanelMessageStreamShellState } from "../../ui/shell-state";

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
  displayItems: readonly DisplayItem[];
  stableItems: readonly DisplayItem[];
  activeItems: readonly DisplayItem[];
  turnDiffs: ChatPanelMessageStreamShellState["messageStream"]["turnDiffs"];
  workspaceRoot: string;
  disclosures: ChatDisclosureUiState;
  forkActionsItemId: string | null;
  implementPlanCandidate: DisplayItem | null;
  rollbackCandidate: RollbackCandidate | null;
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
    displayItems: projection.displayItems,
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
    canImplementPlanItem: (item: DisplayItem) => item.id === projection.implementPlanCandidate?.id,
    onImplementPlanItem: (item) => {
      context.actions.implementPlan(item);
    },
    canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, projection.rollbackCandidate),
    onRollbackItem: () => {
      if (projection.activeThreadId) context.actions.rollbackThread(projection.activeThreadId);
    },
    canForkItem: (item: DisplayItem) => isForkCandidateItem(item, projection.forkCandidates),
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
    workspaceRoot: state.activeThread.cwd ?? vaultPath,
    disclosures: state.ui.disclosures,
    forkActionsItemId: state.ui.messageActions.forkActionsItemId,
    implementPlanCandidate,
    rollbackCandidate,
    forkCandidates,
  };
}
