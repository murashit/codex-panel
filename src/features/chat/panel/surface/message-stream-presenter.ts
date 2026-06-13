import type { App, Component } from "obsidian";
import { copyTextWithNotice } from "../../../../shared/ui/clipboard";
import { chatTurnBusy, type ChatAction, type ChatDisclosureUiState, type ChatStateStore } from "../../state/reducer";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";
import type { ChatMessageStreamActionPort, ChatMessageStreamContextPort, ChatMessageStreamRequestPort } from "./message-stream-ports";
import { createMessageStreamContextPort } from "./message-stream-ports";
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

interface MessageStreamPresenterObsidianPort {
  app: App;
  owner: Component;
}

interface MessageStreamPresenterStatePort {
  store: ChatStateStore;
}

interface MessageStreamPresenterWorkspacePort {
  vaultPath: string;
}

interface MessageStreamPresenterScrollPort {
  consumeIntent: () => MessageStreamScrollIntent;
  registerVirtualizer: (virtualizer: MessageStreamVirtualizerHandle) => () => void;
  dispose: () => void;
}

interface MessageStreamPresenterHistoryPort {
  loadOlderTurns: () => void;
}

export interface MessageStreamPresenterOptions {
  obsidian: MessageStreamPresenterObsidianPort;
  state: MessageStreamPresenterStatePort;
  workspace: MessageStreamPresenterWorkspacePort;
  scroll: MessageStreamPresenterScrollPort;
  history: MessageStreamPresenterHistoryPort;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
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
      blocks: messageStreamBlocks(messageStreamContextFromState(state, this.messageStreamPort())),
      consumeScrollIntent: this.options.scroll.consumeIntent,
      registerVirtualizer: this.options.scroll.registerVirtualizer,
    };
  }

  private messageStreamPort(): ChatMessageStreamContextPort {
    return createMessageStreamContextPort({
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
  port: ChatMessageStreamContextPort,
): MessageStreamContext {
  const projection = messageStreamStateProjection(state, port.vaultPath);

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
    onDisclosureToggle: port.setDisclosureOpen,
    forkActionsItemId: projection.forkActionsItemId,
    onForkActionsToggle: port.setForkActionsItem,
    loadOlderTurns: port.loadOlderTurns,
    renderMarkdown: port.renderMarkdown,
    copyText: port.copyMessageText,
    canImplementPlanItem: (item: DisplayItem) => item.id === projection.implementPlanCandidate?.id,
    onImplementPlanItem: (item) => {
      port.actions.implementPlan(item);
    },
    canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, projection.rollbackCandidate),
    onRollbackItem: () => {
      if (projection.activeThreadId) port.actions.rollbackThread(projection.activeThreadId);
    },
    canForkItem: (item: DisplayItem) => isForkCandidateItem(item, projection.forkCandidates),
    onForkItem: (item, archiveSource) => {
      if (projection.activeThreadId && item.turnId) {
        port.actions.forkThreadFromTurn(projection.activeThreadId, item.turnId, archiveSource);
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
