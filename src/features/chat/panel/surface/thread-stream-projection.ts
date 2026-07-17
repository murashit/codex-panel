import type { TurnDiffViewState } from "../../../turn-diff/model";
import { type PendingRequestBlockActions, pendingRequestBlockStateFromRequestState } from "../../application/pending-requests/block";
import type { ChatRequestState } from "../../application/pending-requests/state";
import {
  type ThreadStreamRollbackCandidate,
  threadStreamActiveItems,
  threadStreamItems,
  threadStreamRollbackCandidateFromItems,
  threadStreamStableItems,
} from "../../application/state/thread-stream";
import { implementPlanTarget } from "../../application/turns/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../../application/turns/turn-state";
import { pendingRequestsSignature } from "../../domain/pending-requests/signatures";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  type ForkCandidate,
  forkCandidatesFromItems,
  type PlanImplementationTarget,
  threadStreamSegmentsEmpty,
} from "../../domain/thread-stream/selectors";
import { type PendingRequestBlockSnapshot, pendingRequestBlockSnapshotFromState } from "../../presentation/pending-requests/view-model";
import type { ThreadStreamTextActionTargets } from "../../presentation/thread-stream/text-view";
import { type ThreadStreamViewBlock, threadStreamViewBlocks } from "../../presentation/thread-stream/view-model";
import type { ThreadStreamContext, ThreadStreamDisclosureBucket, ThreadStreamDisclosureState } from "../../ui/thread-stream/context";
import type { ChatPanelThreadStreamModel } from "../shell-selectors";

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

export interface ChatThreadStreamSurfaceContext {
  panelId: string;
  vaultPath: string;
  setDisclosureOpen: (bucket: ThreadStreamDisclosureBucket, id: string, open: boolean) => void;
  setForkMenuItem: (itemId: string | null) => void;
  loadOlderTurns: () => void;
  renderObsidianMarkdown: (element: HTMLElement, text: string) => void;
  renderStreamMarkdown: (element: HTMLElement, text: string) => void;
  copyDialogueText: (text: string) => void;
  actions: ChatThreadStreamActions;
  requests: ChatThreadStreamRequests;
}

interface ThreadStreamStateProjection {
  activeThreadId: string | null;
  workspaceRoot: string;
  disclosures: ThreadStreamDisclosureState;
  forkMenuItemId: string | null;
  pendingRequests: { signature: string; snapshot: PendingRequestBlockSnapshot } | null;
  viewBlocks: readonly ThreadStreamViewBlock[];
}

interface PendingRequestSurfaceProjection {
  readonly signature: string;
  readonly snapshot: PendingRequestBlockSnapshot;
}

export interface ThreadStreamSurfaceProjection {
  blocks: readonly ThreadStreamViewBlock[];
  context: ThreadStreamContext;
}

export function threadStreamSurfaceProjectionFromModel(
  model: ChatPanelThreadStreamModel,
  context: ChatThreadStreamSurfaceContext,
): ThreadStreamSurfaceProjection {
  const projection = threadStreamStateProjection(model, context);
  return {
    blocks: projection.viewBlocks,
    context: threadStreamContextFromProjection(projection, context),
  };
}

function threadStreamContextFromProjection(
  projection: ThreadStreamStateProjection,
  context: ChatThreadStreamSurfaceContext,
): ThreadStreamContext {
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
    copyText: context.copyDialogueText,
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
    openThreadInNewView: (threadId) => {
      context.actions.openThreadInNewView(threadId);
    },
    openTurnDiff: (turnDiffState) => {
      context.actions.openTurnDiff(turnDiffState);
    },
    ...(pendingRequests
      ? {
          pendingRequests: {
            controlNamespace: context.panelId,
            signature: pendingRequests.signature,
            snapshot: () => pendingRequests.snapshot,
            actions: context.requests.pendingActions,
            consumeAutoFocus: context.requests.consumePendingAutoFocus,
          },
        }
      : {}),
  };
}

function threadStreamStateProjection(
  model: ChatPanelThreadStreamModel,
  context: ChatThreadStreamSurfaceContext,
): ThreadStreamStateProjection {
  const canonicalItems = threadStreamItems(model.threadStream);
  const stableItems = model.threadStream.activeSegment
    ? threadStreamStableItems(model.threadStream)
    : appendPendingSubmission(threadStreamStableItems(model.threadStream), model.pendingSubmission);
  const activeItems = model.threadStream.activeSegment
    ? appendPendingSubmission(threadStreamActiveItems(model.threadStream), model.pendingSubmission)
    : threadStreamActiveItems(model.threadStream);
  const items = appendPendingSubmission(canonicalItems, model.pendingSubmission);
  const disclosures = {
    details: model.disclosureDetails,
    activityGroups: model.disclosureActivityGroups,
    textDetails: model.disclosureTextDetails,
    userDialogueExpanded: model.disclosureUserDialogueExpanded,
    approvalDetails: model.disclosureApprovalDetails,
  };
  const workspaceRoot = model.activeThreadCwd ?? context.vaultPath;
  const turnBusy = chatTurnBusy(model.turn);
  const rollbackCandidate = !turnBusy && model.rollbackAllowed ? threadStreamRollbackCandidateFromItems(canonicalItems) : null;
  const forkCandidates = !turnBusy && model.forkAllowed ? forkCandidatesFromItems(canonicalItems) : [];
  const planTarget = implementPlanTarget({
    activeThread: model.activeThreadId ? { id: model.activeThreadId } : null,
    modeAllowed: model.planImplementationAllowed,
    turn: model.turn,
    runtime: { pending: { collaborationMode: model.runtimeCollaborationMode } },
    threadStream: model.threadStream,
  });
  const textActionTargetsByItemId = textActionTargetsForThreadStreamItems(rollbackCandidate, forkCandidates, planTarget);
  const pendingRequests = threadStreamSegmentsEmpty(stableItems, activeItems)
    ? null
    : pendingRequestSurfaceProjectionFromState(model.requests, disclosures.approvalDetails);

  return {
    activeThreadId: model.activeThreadId,
    workspaceRoot,
    disclosures,
    forkMenuItemId: model.forkMenuItemId,
    pendingRequests,
    viewBlocks: threadStreamViewBlocks({
      activeThreadId: model.activeThreadId,
      activeTurnId: activeTurnId(model.turn),
      historyCursor: model.threadStream.historyCursor,
      loadingHistory: model.threadStream.loadingHistory,
      items,
      stableItems,
      activeItems,
      workspaceRoot,
      turnDiffs: model.threadStream.turnDiffs,
      textActionTargetsByItemId,
      pendingRequests,
    }),
  };
}

function appendPendingSubmission(
  items: readonly ThreadStreamItem[],
  pendingSubmission: ChatPanelThreadStreamModel["pendingSubmission"],
): readonly ThreadStreamItem[] {
  return pendingSubmission ? [...items, pendingSubmission.item] : items;
}

function textActionTargetsForThreadStreamItems(
  rollbackCandidate: ThreadStreamRollbackCandidate | null,
  forkCandidates: readonly ForkCandidate[],
  implementPlanTarget: PlanImplementationTarget | null,
): ReadonlyMap<string, ThreadStreamTextActionTargets> {
  const byItemId = new Map<string, ThreadStreamTextActionTargets>();
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

function pendingRequestSurfaceProjectionFromState(
  requests: ChatRequestState,
  approvalDetails: ReadonlySet<string>,
): PendingRequestSurfaceProjection | null {
  const signature = pendingRequestsSignature(
    requests.approvals,
    requests.pendingUserInputs,
    requests.pendingMcpElicitations,
    requests.userInputDrafts,
    requests.mcpElicitationDrafts,
  );
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequestBlockSnapshotFromState(pendingRequestBlockStateFromRequestState(requests, approvalDetails)),
  };
}

function patchTextActionTargets(
  byItemId: Map<string, ThreadStreamTextActionTargets>,
  itemId: string,
  patch: ThreadStreamTextActionTargets,
): void {
  byItemId.set(itemId, { ...byItemId.get(itemId), ...patch });
}
