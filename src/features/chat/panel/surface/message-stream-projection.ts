import {
  activeTurnId,
  chatTurnBusy,
  type ChatAction,
  type ChatDisclosureBucket,
  type ChatDisclosureUiState,
} from "../../application/state/root-reducer";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { messageStreamViewBlocks, type MessageStreamViewBlock } from "../../presentation/message-stream/view-model";
import { implementPlanTargetFromState } from "../../application/state/selectors";
import { type ForkCandidate, forkCandidatesFromItems, type PlanImplementationTarget } from "../../domain/message-stream/selectors";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidate,
  messageStreamStableItems,
  type MessageStreamRollbackCandidate,
} from "../../application/state/message-stream";
import type { MessageStreamContext } from "../../ui/message-stream/context";
import type { ChatPanelMessageStreamShellState } from "../shell-state";
import { pendingRequestBlockSnapshotFromState } from "../../presentation/pending-requests/snapshot";
import type { PendingRequestBlockActions, PendingRequestBlockState } from "../../application/pending-requests/block";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";
import type { MessageStreamTextActions } from "../../presentation/message-stream/text-view";

interface ChatMessageStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (itemId: string) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
}

interface ChatMessageStreamRequests {
  pendingSignature: () => string;
  pendingSnapshot: () => PendingRequestBlockState;
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

interface MessageStreamStateProjection {
  activeThreadId: string | null;
  workspaceRoot: string;
  disclosures: ChatDisclosureUiState;
  forkActionsItemId: string | null;
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

export function messageStreamSurfaceProjectionFromState(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamSurfaceProjection {
  const projection = messageStreamStateProjection(state, context);
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
    workspaceRoot: projection.workspaceRoot,
    disclosures: projection.disclosures,
    onDisclosureToggle: context.setDisclosureOpen,
    forkActionsItemId: projection.forkActionsItemId,
    onForkActionsToggle: context.setForkActionsItem,
    loadOlderTurns: context.loadOlderTurns,
    renderMarkdown: context.renderMarkdown,
    copyText: context.copyMessageText,
    onImplementPlan: (target) => {
      context.actions.implementPlan(target.itemId);
    },
    onRollback: () => {
      if (projection.activeThreadId) context.actions.rollbackThread(projection.activeThreadId);
    },
    onFork: (target, archiveSource) => {
      if (projection.activeThreadId) {
        context.actions.forkThreadFromTurn(projection.activeThreadId, target.turnId, archiveSource);
      }
    },
    openTurnDiff: (turnDiffState) => {
      context.actions.openTurnDiff(turnDiffState);
    },
    pendingRequests: {
      signature: context.requests.pendingSignature(),
      snapshot: () => pendingRequestBlockSnapshotFromState(context.requests.pendingSnapshot()),
      actions: context.requests.pendingActions,
      consumeAutoFocus: context.requests.consumePendingAutoFocus,
    },
  };
}

function messageStreamStateProjection(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamStateProjection {
  const busy = chatTurnBusy(state);
  const items = messageStreamItems(state.messageStream);
  const stableItems = messageStreamStableItems(state.messageStream);
  const activeItems = messageStreamActiveItems(state.messageStream);
  const workspaceRoot = state.activeThread.cwd ?? context.vaultPath;
  const rollbackCandidate = busy ? null : messageStreamRollbackCandidate(state.messageStream);
  const forkCandidates = busy ? [] : forkCandidatesFromItems(items);
  const implementPlanTarget = implementPlanTargetFromState(state);
  const textActionsByItemId = textActionsForMessageStreamItems(rollbackCandidate, forkCandidates, implementPlanTarget);
  const activeTurn = activeTurnId({ lifecycle: state.turn.lifecycle });

  return {
    activeThreadId: state.activeThread.id,
    workspaceRoot,
    disclosures: state.ui.disclosures,
    forkActionsItemId: state.ui.messageActions.forkActionsItemId,
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
      textActionsByItemId,
      pendingRequests: messageStreamBlockItemsEmpty(stableItems, activeItems) ? null : pendingRequestBlockFromContext(context),
    }),
  };
}

function textActionsForMessageStreamItems(
  rollbackCandidate: MessageStreamRollbackCandidate | null,
  forkCandidates: readonly ForkCandidate[],
  implementPlanTarget: PlanImplementationTarget | null,
): ReadonlyMap<string, MessageStreamTextActions> {
  const byItemId = new Map<string, MessageStreamTextActions>();
  for (const candidate of forkCandidates) {
    patchTextActions(byItemId, candidate.itemId, { fork: { itemId: candidate.itemId, turnId: candidate.turnId } });
  }
  if (rollbackCandidate) {
    patchTextActions(byItemId, rollbackCandidate.itemId, { rollback: true });
  }
  if (implementPlanTarget) {
    patchTextActions(byItemId, implementPlanTarget.itemId, { implementPlan: implementPlanTarget });
  }
  return byItemId;
}

function patchTextActions(byItemId: Map<string, MessageStreamTextActions>, itemId: string, patch: MessageStreamTextActions): void {
  byItemId.set(itemId, { ...byItemId.get(itemId), ...patch });
}

function pendingRequestBlockFromContext(
  context: ChatMessageStreamSurfaceContext,
): { signature: string; snapshot: ReturnType<typeof pendingRequestBlockSnapshotFromState> } | null {
  const signature = context.requests.pendingSignature();
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequestBlockSnapshotFromState(context.requests.pendingSnapshot()),
  };
}

function messageStreamBlockItemsEmpty(stableItems: readonly MessageStreamItem[], activeItems: readonly MessageStreamItem[]): boolean {
  return stableItems.length === 0 && activeItems.length === 0;
}
