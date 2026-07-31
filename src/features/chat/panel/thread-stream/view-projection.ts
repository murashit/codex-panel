import { threadDisplayTitle } from "../../../../domain/threads/title";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import type { ChatRequestState } from "../../application/pending-requests/state";
import { chatThreadStreamViewState } from "../../application/state/active-turn";
import {
  type ThreadStreamRollbackCandidate,
  threadStreamActiveItems,
  threadStreamItems,
  threadStreamPendingSteers,
  threadStreamRollbackCandidateFromItems,
  threadStreamStableItems,
} from "../../application/state/thread-stream";
import { implementPlanTarget } from "../../application/submission/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../../application/turns/turn-state";
import { pendingRequestsSignature } from "../../domain/pending-requests/signatures";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  type ForkCandidate,
  forkCandidatesFromItems,
  type PlanImplementationTarget,
  threadStreamSegmentsEmpty,
} from "../../domain/thread-stream/selectors";
import type { ActiveSubagentActivity } from "../../domain/thread-stream/semantics/active-turn";
import type { ThreadStreamContext, ThreadStreamDisclosureBucket, ThreadStreamDisclosureState } from "../../ui/thread-stream/context";
import type { PendingRequestBlockSnapshot, ThreadStreamTextActionTargets, ThreadStreamViewBlock } from "../../ui/thread-stream/model";
import type { ChatPanelThreadStreamModel } from "../shell/selectors";
import { threadStreamViewBlocks } from "./blocks";
import { pendingRequestBlockSnapshotFromState } from "./pending-requests";
import { subagentActivityPreview } from "./subagent-preview";

export interface ChatThreadStreamActions {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (itemId: string) => void;
  openThreadInAvailableView: (threadId: string) => void;
  openThreadInNewView: (threadId: string) => void;
  openTurnDiff: (state: TurnDiffViewState) => void;
}

export interface ChatThreadStreamRequests {
  actions: PendingRequestActions["actions"];
  consumeAutoFocus: () => boolean;
}

export interface ChatThreadStreamDependencies {
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
  disclosures: ThreadStreamDisclosureState;
  forkMenuItemId: string | null;
  viewBlocks: readonly ThreadStreamViewBlock[];
}

interface PendingRequestProjection {
  readonly signature: string;
  readonly snapshot: PendingRequestBlockSnapshot;
}

interface ThreadStreamProjection {
  blocks: readonly ThreadStreamViewBlock[];
  context: ThreadStreamContext;
}

export function projectThreadStream(model: ChatPanelThreadStreamModel, dependencies: ChatThreadStreamDependencies): ThreadStreamProjection {
  const projection = threadStreamStateProjection(model, dependencies);
  return {
    blocks: projection.viewBlocks,
    context: threadStreamContextFromProjection(projection, dependencies),
  };
}

function threadStreamContextFromProjection(
  projection: ThreadStreamStateProjection,
  dependencies: ChatThreadStreamDependencies,
): ThreadStreamContext {
  return {
    activeThreadId: projection.activeThreadId,
    disclosures: projection.disclosures,
    onDisclosureToggle: dependencies.setDisclosureOpen,
    forkMenuItemId: projection.forkMenuItemId,
    onForkMenuToggle: dependencies.setForkMenuItem,
    loadOlderTurns: dependencies.loadOlderTurns,
    renderObsidianMarkdown: dependencies.renderObsidianMarkdown,
    renderStreamMarkdown: dependencies.renderStreamMarkdown,
    copyText: dependencies.copyDialogueText,
    onImplementPlan: (target) => {
      dependencies.actions.implementPlan(target.itemId);
    },
    onRollback: () => {
      if (projection.activeThreadId) dependencies.actions.rollbackThread(projection.activeThreadId);
    },
    onFork: (target, archiveSource) => {
      if (projection.activeThreadId) {
        dependencies.actions.forkThreadFromTurn(projection.activeThreadId, target.turnId, archiveSource);
      }
    },
    openThreadInNewView: dependencies.actions.openThreadInNewView,
    openTurnDiff: dependencies.actions.openTurnDiff,
    pendingRequests: {
      controlNamespace: dependencies.panelId,
      actions: dependencies.requests.actions,
      consumeAutoFocus: dependencies.requests.consumeAutoFocus,
    },
  };
}

function threadStreamStateProjection(
  model: ChatPanelThreadStreamModel,
  dependencies: ChatThreadStreamDependencies,
): ThreadStreamStateProjection {
  const stream = chatThreadStreamViewState(model.threadStream, model.activeTurn);
  const canonicalItems = threadStreamItems(stream);
  const pendingSteers = threadStreamPendingSteers(stream);
  const stableItemsRaw = model.activeTurn.activeSegment
    ? threadStreamStableItems(model.threadStream)
    : appendPendingDisplayItems(threadStreamStableItems(model.threadStream), pendingSteers, model.pendingSubmission);
  const activeItemsRaw = model.activeTurn.activeSegment
    ? appendPendingDisplayItems(threadStreamActiveItems(stream), pendingSteers, model.pendingSubmission)
    : threadStreamActiveItems(stream);
  const titleByThreadId = new Map(model.threads.map((thread) => [thread.id, threadDisplayTitle(thread)] as const));
  const items = resolvedReferenceTitles(appendPendingDisplayItems(canonicalItems, pendingSteers, model.pendingSubmission), titleByThreadId);
  const stableItems = resolvedReferenceTitles(stableItemsRaw, titleByThreadId);
  const activeItems = resolvedReferenceTitles(activeItemsRaw, titleByThreadId);
  const disclosures = {
    details: model.disclosureDetails,
    activityGroups: model.disclosureActivityGroups,
    textDetails: model.disclosureTextDetails,
    userDialogueExpanded: model.disclosureUserDialogueExpanded,
  };
  const workspaceRoot = dependencies.vaultPath;
  const subagentActivities = new Map<string, ActiveSubagentActivity>();
  for (const [threadId, activity] of model.activeTurn.subagents.byThreadId) {
    const preview = subagentActivityPreview(activity.latestItem, workspaceRoot);
    subagentActivities.set(threadId, {
      executionState: activity.executionState,
      messagePreview: preview,
    });
  }
  const turnBusy = chatTurnBusy(model.activeTurn);
  const rollbackCandidate = !turnBusy && model.rollbackAllowed ? threadStreamRollbackCandidateFromItems(canonicalItems) : null;
  const forkCandidates = !turnBusy && model.forkAllowed ? forkCandidatesFromItems(canonicalItems) : [];
  const planTarget = implementPlanTarget({
    activeThread: model.activeThreadId ? { id: model.activeThreadId } : null,
    modeAllowed: model.planImplementationAllowed,
    activeTurn: model.activeTurn,
    runtime: { pending: { collaborationMode: model.runtimeCollaborationMode } },
    threadStream: stream,
  });
  const textActionTargetsByItemId = textActionTargetsForThreadStreamItems(rollbackCandidate, forkCandidates, planTarget);
  const pendingRequests = threadStreamSegmentsEmpty(stableItems, activeItems)
    ? null
    : pendingRequestProjectionFromState(model.requests, model.disclosureApprovalDetails);

  return {
    activeThreadId: model.activeThreadId,
    disclosures,
    forkMenuItemId: model.forkMenuItemId,
    viewBlocks: threadStreamViewBlocks({
      activeThreadId: model.activeThreadId,
      activeTurnId: activeTurnId(model.activeTurn),
      historyCursor: model.threadStream.historyCursor,
      loadingHistory: model.threadStream.loadingHistory,
      items,
      stableItems,
      activeItems,
      workspaceRoot,
      turnDiffs: model.threadStream.turnDiffs,
      textActionTargetsByItemId,
      pendingRequests,
      subagentActivities,
    }),
  };
}

function resolvedReferenceTitles(
  items: readonly ThreadStreamItem[],
  titleByThreadId: ReadonlyMap<string, string>,
): readonly ThreadStreamItem[] {
  return items.map((item) => {
    if (item.kind !== "dialogue" || !item.referencedThread) return item;
    const title = titleByThreadId.get(item.referencedThread.threadId);
    return title ? { ...item, referencedThread: { ...item.referencedThread, title } } : item;
  });
}

function appendPendingDisplayItems(
  items: readonly ThreadStreamItem[],
  pendingSteers: readonly ThreadStreamItem[],
  pendingSubmission: ChatPanelThreadStreamModel["pendingSubmission"],
): readonly ThreadStreamItem[] {
  if (pendingSteers.length === 0 && !pendingSubmission) return items;
  return [...items, ...pendingSteers, ...(pendingSubmission ? [pendingSubmission.item] : [])];
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

function pendingRequestProjectionFromState(
  requests: ChatRequestState,
  approvalDetails: ReadonlySet<string>,
): PendingRequestProjection | null {
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
    snapshot: pendingRequestBlockSnapshotFromState({
      approvals: requests.approvals,
      pendingUserInputs: requests.pendingUserInputs,
      pendingMcpElicitations: requests.pendingMcpElicitations,
      userInputDrafts: requests.userInputDrafts,
      mcpElicitationDrafts: requests.mcpElicitationDrafts,
      approvalDetails,
    }),
  };
}

function patchTextActionTargets(
  byItemId: Map<string, ThreadStreamTextActionTargets>,
  itemId: string,
  patch: ThreadStreamTextActionTargets,
): void {
  byItemId.set(itemId, { ...byItemId.get(itemId), ...patch });
}
