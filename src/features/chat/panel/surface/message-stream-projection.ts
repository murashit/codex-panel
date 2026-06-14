import { activeTurnId, chatTurnBusy, type ChatAction, type ChatDisclosureBucket, type ChatDisclosureUiState } from "../../state/reducer";
import type { MessageStreamItem } from "../../domain/message-stream/model/items";
import { messageStreamViewBlocks, type MessageStreamViewBlock } from "../../presentation/message-stream/view-model";
import { implementPlanCandidateFromState } from "../../state/selectors";
import {
  type ForkCandidate,
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
} from "../../domain/message-stream/queries/selectors";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidate,
  messageStreamStableItems,
  type MessageStreamRollbackCandidate,
} from "../../state/message-stream";
import type { MessageStreamContext } from "../../ui/message-stream/context";
import type { ChatPanelMessageStreamShellState } from "../../ui/shell-state";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../conversation/pending-requests/view-model";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";

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

export interface MessageStreamSurfaceContextOptions {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
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
  viewBlocks: readonly MessageStreamViewBlock[];
}

export interface MessageStreamSurfaceProjection {
  blocks: readonly MessageStreamViewBlock[];
  context: MessageStreamContext;
}

export function createMessageStreamSurfaceContext(options: MessageStreamSurfaceContextOptions): ChatMessageStreamSurfaceContext {
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

export function messageStreamContextFromState(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamContext {
  const projection = messageStreamStateProjection(state, context.vaultPath);
  return messageStreamContextFromProjection(projection, context);
}

export function messageStreamSurfaceProjectionFromState(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamSurfaceProjection {
  const projection = messageStreamStateProjection(state, context.vaultPath);
  return {
    blocks: projection.viewBlocks,
    context: messageStreamContextFromProjection(projection, context),
  };
}

function messageStreamContextFromProjection(
  projection: MessageStreamStateProjection,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamContext {
  return {
    activeThreadId: projection.activeThreadId,
    turnLifecycle: projection.turnLifecycle,
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
  const stableItems = messageStreamStableItems(state.messageStream);
  const activeItems = messageStreamActiveItems(state.messageStream);
  const workspaceRoot = state.activeThread.cwd ?? vaultPath;
  const rollbackCandidate = busy ? null : messageStreamRollbackCandidate(state.messageStream);
  const forkCandidates = busy ? [] : forkCandidatesFromItems(items);
  const implementPlanCandidate = implementPlanCandidateFromState(state);
  const activeTurn = activeTurnId({ lifecycle: state.turn.lifecycle });

  return {
    activeThreadId: state.activeThread.id,
    turnLifecycle: state.turn.lifecycle,
    historyCursor: state.messageStream.historyCursor,
    loadingHistory: state.messageStream.loadingHistory,
    items,
    stableItems,
    activeItems,
    turnDiffs: state.messageStream.turnDiffs,
    workspaceRoot,
    disclosures: state.ui.disclosures,
    forkActionsItemId: state.ui.messageActions.forkActionsItemId,
    implementPlanCandidate,
    rollbackCandidate,
    forkCandidates,
    viewBlocks: messageStreamViewBlocks({
      activeThreadId: state.activeThread.id,
      activeTurnId: activeTurn,
      historyCursor: state.messageStream.historyCursor,
      loadingHistory: state.messageStream.loadingHistory,
      items,
      stableItems,
      activeItems,
      workspaceRoot,
      turnDiffs: state.messageStream.turnDiffs,
    }),
  };
}
