import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { MessageStreamRollbackCandidate } from "../../application/state/message-stream";
import type { ChatAction } from "../../application/state/root-reducer";
import { type ForkCandidate, messageStreamSegmentsEmpty, type PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { MessageStreamTextActionTargets } from "../../presentation/message-stream/text-view";
import { type MessageStreamViewBlock, messageStreamViewBlocks } from "../../presentation/message-stream/view-model";
import type { PendingRequestBlockSnapshot } from "../../presentation/pending-requests/view-model";
import type { MessageStreamContext, MessageStreamDisclosureBucket, MessageStreamDisclosureState } from "../../ui/message-stream/context";
import type { ChatPanelMessageStreamReadModel } from "../shell-read-model";
import { pendingRequestSurfaceProjectionFromState } from "./pending-request-block-projection";

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

export interface ChatMessageStreamSurfaceContext {
  vaultPath: string;
  setDisclosureOpen: (bucket: MessageStreamDisclosureBucket, id: string, open: boolean) => void;
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
  disclosures: MessageStreamDisclosureState;
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

export function messageStreamSurfaceProjectionFromModel(
  model: ChatPanelMessageStreamReadModel,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamSurfaceProjection {
  const projection = messageStreamStateProjection(model, context);
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
  model: ChatPanelMessageStreamReadModel,
  context: ChatMessageStreamSurfaceContext,
): MessageStreamStateProjection {
  const stableItems = model.stableItems.value;
  const activeItems = model.activeItems.value;
  const disclosures = model.disclosures.value;
  const workspaceRoot = model.activeThreadCwd.value ?? context.vaultPath;
  const textActionTargetsByItemId = textActionTargetsForMessageStreamItems(
    model.rollbackCandidate.value,
    model.forkCandidates.value,
    model.implementPlanTarget.value,
  );
  const pendingRequests = messageStreamSegmentsEmpty(stableItems, activeItems)
    ? null
    : pendingRequestSurfaceProjectionFromState(model.requests.value, disclosures.approvalDetails);

  return {
    activeThreadId: model.activeThreadId.value,
    workspaceRoot,
    disclosures,
    forkMenuItemId: model.forkMenuItemId.value,
    pendingRequests,
    viewBlocks: messageStreamViewBlocks({
      activeThreadId: model.activeThreadId.value,
      activeTurnId: model.activeTurnId.value,
      historyCursor: model.historyCursor.value,
      loadingHistory: model.loadingHistory.value,
      items: model.items.value,
      stableItems,
      activeItems,
      workspaceRoot,
      turnDiffs: model.turnDiffs.value,
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
