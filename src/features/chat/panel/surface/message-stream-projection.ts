import type { ChatAction, ChatDisclosureBucket, ChatDisclosureUiState } from "../../application/state/root-reducer";
import { messageStreamViewBlocks, type MessageStreamViewBlock } from "../../presentation/message-stream/view-model";
import { messageStreamSegmentsEmpty, type ForkCandidate, type PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { MessageStreamRollbackCandidate } from "../../application/state/message-stream";
import type { MessageStreamContext } from "../../ui/message-stream/context";
import type { ChatPanelMessageStreamShellState } from "../shell-state";
import { pendingRequestBlockSnapshotFromState, type PendingRequestBlockSnapshot } from "../../presentation/pending-requests/view-model";
import { pendingRequestBlockStateFromChatState, type PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";
import type { MessageStreamTextActionTargets } from "../../presentation/message-stream/text-view";
import { pendingRequestsSignature } from "../../domain/pending-requests/signatures";

interface ChatMessageStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (itemId: string) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
}

interface ChatMessageStreamRequests {
  pendingActions: () => PendingRequestBlockActions;
  consumePendingAutoFocus: () => boolean;
}

export interface ChatMessageStreamSurfaceContext {
  vaultPath: string;
  setDisclosureOpen: (bucket: ChatDisclosureBucket, id: string, open: boolean) => void;
  setForkMenuItem: (itemId: string | null) => void;
  loadOlderTurns: () => void;
  renderObsidianMarkdown: (element: HTMLElement, text: string) => void;
  renderStreamMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActions;
  requests: ChatMessageStreamRequests;
}

export interface MessageStreamSurfaceContextOptions {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
  loadOlderTurns: () => void;
  renderObsidianMarkdown: (element: HTMLElement, text: string) => void;
  renderStreamMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActions;
  requests: ChatMessageStreamRequests;
}

interface MessageStreamStateProjection {
  activeThreadId: string | null;
  workspaceRoot: string;
  disclosures: ChatDisclosureUiState;
  forkMenuItemId: string | null;
  pendingRequests: { signature: string; snapshot: PendingRequestBlockSnapshot } | null;
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
    setForkMenuItem: (itemId) => {
      options.dispatch({ type: "ui/message-fork-menu-set", itemId });
    },
    loadOlderTurns: options.loadOlderTurns,
    renderObsidianMarkdown: options.renderObsidianMarkdown,
    renderStreamMarkdown: options.renderStreamMarkdown,
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
  const pendingRequests = projection.pendingRequests;
  return {
    activeThreadId: projection.activeThreadId,
    workspaceRoot: projection.workspaceRoot,
    disclosures: projection.disclosures,
    onDisclosureToggle: context.setDisclosureOpen,
    forkMenuItemId: projection.forkMenuItemId,
    onForkMenuToggle: context.setForkMenuItem,
    loadOlderTurns: context.loadOlderTurns,
    renderObsidianMarkdown: context.renderObsidianMarkdown,
    renderStreamMarkdown: context.renderStreamMarkdown,
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
    ...(pendingRequests
      ? {
          pendingRequests: {
            signature: pendingRequests.signature,
            snapshot: () => pendingRequests.snapshot,
            actions: context.requests.pendingActions,
            consumeAutoFocus: context.requests.consumePendingAutoFocus,
          },
        }
      : {}),
  };
}

function messageStreamStateProjection(
  state: ChatPanelMessageStreamShellState,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamStateProjection {
  const workspaceRoot = state.activeThreadCwd ?? context.vaultPath;
  const textActionTargetsByItemId = textActionTargetsForMessageStreamItems(
    state.rollbackCandidate,
    state.forkCandidates,
    state.implementPlanTarget,
  );
  const pendingRequests = messageStreamSegmentsEmpty(state.stableItems, state.activeItems) ? null : pendingRequestBlockFromState(state);

  return {
    activeThreadId: state.activeThreadId,
    workspaceRoot,
    disclosures: state.ui.disclosures,
    forkMenuItemId: state.ui.messageActionMenu.forkMenuItemId,
    pendingRequests,
    viewBlocks: messageStreamViewBlocks({
      activeThreadId: state.activeThreadId,
      activeTurnId: state.activeTurnId,
      historyCursor: state.messageStream.historyCursor,
      loadingHistory: state.messageStream.loadingHistory,
      items: state.items,
      stableItems: state.stableItems,
      activeItems: state.activeItems,
      workspaceRoot,
      turnDiffs: state.messageStream.turnDiffs,
      textActionTargetsByItemId,
      pendingRequests,
    }),
  };
}

function textActionTargetsForMessageStreamItems(
  rollbackCandidate: MessageStreamRollbackCandidate | null,
  forkCandidates: readonly ForkCandidate[],
  implementPlanTarget: PlanImplementationTarget | null,
): ReadonlyMap<string, MessageStreamTextActionTargets> {
  const byItemId = new Map<string, MessageStreamTextActionTargets>();
  for (const candidate of forkCandidates) {
    patchTextActionTargets(byItemId, candidate.itemId, { fork: { itemId: candidate.itemId, turnId: candidate.turnId } });
  }
  if (rollbackCandidate) {
    patchTextActionTargets(byItemId, rollbackCandidate.itemId, { rollback: true });
  }
  if (implementPlanTarget) {
    patchTextActionTargets(byItemId, implementPlanTarget.itemId, { implementPlan: implementPlanTarget });
  }
  return byItemId;
}

function patchTextActionTargets(
  byItemId: Map<string, MessageStreamTextActionTargets>,
  itemId: string,
  patch: MessageStreamTextActionTargets,
): void {
  byItemId.set(itemId, { ...byItemId.get(itemId), ...patch });
}

function pendingRequestBlockFromState(
  state: ChatPanelMessageStreamShellState,
): { signature: string; snapshot: ReturnType<typeof pendingRequestBlockSnapshotFromState> } | null {
  const signature = pendingRequestsSignature(
    state.requests.approvals,
    state.requests.pendingUserInputs,
    state.requests.pendingMcpElicitations,
    state.requests.userInputDrafts,
    state.requests.mcpElicitationDrafts,
  );
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequestBlockSnapshotFromState(pendingRequestBlockStateFromChatState(state)),
  };
}
