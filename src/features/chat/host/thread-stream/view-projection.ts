import { threadDisplayTitle } from "../../../../domain/threads/title";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import {
  type ThreadStreamRollbackCandidate,
  threadStreamActiveItems,
  threadStreamItems,
  threadStreamPendingSteers,
  threadStreamRollbackCandidateFromItems,
  threadStreamStableItems,
} from "../../application/state/thread-stream";
import { chatThreadStreamViewState } from "../../application/state/turn-scope";
import { implementPlanTarget } from "../../application/submission/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../../application/turns/turn-state";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import {
  type ForkCandidate,
  forkCandidatesFromItems,
  type PlanImplementationTarget,
  threadStreamSegmentsEmpty,
} from "../../domain/thread-stream/selectors";
import type { ActiveSubagentActivity } from "../../domain/thread-stream/semantics/agent-run-summary";
import { threadStreamViewBlocks } from "../../ui/thread-stream/blocks";
import type { ThreadStreamContext, ThreadStreamDisclosureBucket } from "../../ui/thread-stream/context";
import type { ThreadStreamTextActionTargets, ThreadStreamViewBlock } from "../../ui/thread-stream/model";
import { projectPendingRequestBlock } from "../../ui/thread-stream/pending-requests";
import { subagentActivityPreview } from "../../ui/thread-stream/subagent-preview";
import type { ChatPanelThreadStreamModel } from "../shell/selectors";

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

interface ThreadStreamProjection {
  blocks: readonly ThreadStreamViewBlock[];
  context: ThreadStreamContext;
}

export function projectThreadStream(model: ChatPanelThreadStreamModel, dependencies: ChatThreadStreamDependencies): ThreadStreamProjection {
  return {
    blocks: projectThreadStreamBlocks(model, dependencies),
    context: threadStreamContext(model, dependencies),
  };
}

function threadStreamContext(model: ChatPanelThreadStreamModel, dependencies: ChatThreadStreamDependencies): ThreadStreamContext {
  return {
    activeThreadId: model.activeThreadId,
    disclosures: {
      details: model.disclosureDetails,
      activityGroups: model.disclosureActivityGroups,
      textDetails: model.disclosureTextDetails,
      userDialogueExpanded: model.disclosureUserDialogueExpanded,
    },
    onDisclosureToggle: dependencies.setDisclosureOpen,
    forkMenuItemId: model.forkMenuItemId,
    onForkMenuToggle: dependencies.setForkMenuItem,
    loadOlderTurns: dependencies.loadOlderTurns,
    renderObsidianMarkdown: dependencies.renderObsidianMarkdown,
    renderStreamMarkdown: dependencies.renderStreamMarkdown,
    copyText: dependencies.copyDialogueText,
    onImplementPlan: (target) => {
      dependencies.actions.implementPlan(target.itemId);
    },
    onRollback: () => {
      if (model.activeThreadId) dependencies.actions.rollbackThread(model.activeThreadId);
    },
    onFork: (target, archiveSource) => {
      if (model.activeThreadId) {
        dependencies.actions.forkThreadFromTurn(model.activeThreadId, target.turnId, archiveSource);
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

function projectThreadStreamBlocks(
  model: ChatPanelThreadStreamModel,
  dependencies: ChatThreadStreamDependencies,
): readonly ThreadStreamViewBlock[] {
  const stream = chatThreadStreamViewState(model.threadStream, model.activeTurn);
  const canonicalItems = threadStreamItems(stream);
  const pendingSteers = threadStreamPendingSteers(stream);
  const stableItems = model.activeTurn.activeSegment
    ? threadStreamStableItems(model.threadStream)
    : appendPendingDisplayItems(threadStreamStableItems(model.threadStream), pendingSteers, model.pendingSubmission);
  const activeItems = model.activeTurn.activeSegment
    ? appendPendingDisplayItems(threadStreamActiveItems(stream), pendingSteers, model.pendingSubmission)
    : threadStreamActiveItems(stream);
  const titleByThreadId = new Map(model.threads.map((thread) => [thread.id, threadDisplayTitle(thread)] as const));
  const items = appendPendingDisplayItems(canonicalItems, pendingSteers, model.pendingSubmission);
  const workspaceRoot = dependencies.vaultPath;
  const subagentActivities = new Map<string, ActiveSubagentActivity>();
  for (const [threadId, activity] of model.activeTurn.subagents.byThreadId) {
    const preview = activity.statusPreview ?? subagentActivityPreview(activity.latestItem, workspaceRoot);
    subagentActivities.set(threadId, {
      agentLabel: activity.agentLabel,
      liveness: activity.liveness,
      outcome: activity.outcome,
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
    : projectPendingRequestBlock({ ...model.requests, approvalDetails: model.disclosureApprovalDetails });

  return threadStreamViewBlocks({
    referenceTitles: titleByThreadId,
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
    authRecovery: model.activeTurn.authRecovery,
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

function patchTextActionTargets(
  byItemId: Map<string, ThreadStreamTextActionTargets>,
  itemId: string,
  patch: ThreadStreamTextActionTargets,
): void {
  byItemId.set(itemId, { ...byItemId.get(itemId), ...patch });
}
