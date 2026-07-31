import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { Thread } from "../../../../domain/threads/model";
import { activeThreadRuntimeState } from "../../domain/runtime/state";
import { type EffectOutcome, effectCompleted, effectCompletedInCurrentContext } from "../effect-outcome";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { chatThreadStreamViewState } from "../state/active-turn";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamRollbackCandidate, threadStreamTurnsAfterTurnId } from "../state/thread-stream";
import { chatTurnBusy } from "../turns/turn-state";

type ThreadForkPosition =
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

interface ThreadForkOptions {
  readonly position?: ThreadForkPosition;
  readonly deferGoalContinuation?: boolean;
  readonly runtime?: ThreadForkRuntimeOverrides;
}

interface ThreadForkRuntimeOverrides {
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort | null;
  readonly serviceTier?: ServiceTier | null;
  readonly approvalPolicy?: RuntimeApprovalPolicy;
  readonly approvalsReviewer?: ApprovalsReviewer;
  readonly permissions?: string;
  readonly sandboxPolicy?: RuntimeSandboxPolicy;
}

export interface ThreadCommandEffects {
  compactThread(threadId: string): Promise<EffectOutcome<void>>;
  forkThread(threadId: string, options?: ThreadForkOptions): Promise<EffectOutcome<Thread>>;
}

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
const STATUS_ROLLBACK_STARTING = "Rolling back the latest turn...";
const STATUS_ROLLBACK_COMPLETE = "Rolled back the latest turn.";
const STATUS_ROLLBACK_FAILED = "Could not roll back the latest turn.";

export interface ThreadCommandsHost {
  stateStore: ChatStateStore;
  mutations: ThreadManagementMutations;
  effects: ThreadCommandEffects;
  ensureConnected: () => Promise<boolean>;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<void>;
  openThreadInCurrentPanel: (threadId: string, onAdopted: () => void, beforeActivate?: () => void) => Promise<CurrentPanelAdoption>;
  applyThreadFact: (fact: ThreadUpsertFact) => void;
  threadPanelIsBusy: (threadId: string) => boolean;
}

type CurrentPanelAdoption = { readonly adopted: boolean };

interface ThreadUpsertFact {
  readonly type: "thread-upserted";
  readonly thread: Thread;
}

interface ThreadManagementMutations {
  renameThread(threadId: string, value: string): Promise<boolean>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(
    threadId: string,
    options?: { saveMarkdown?: boolean; beforePublish?: () => void; additionalFacts?: readonly ThreadUpsertFact[] },
  ): Promise<boolean>;
}

export interface ThreadCommands {
  compactActiveThread: () => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean, beforeUnavailable?: () => void) => Promise<void>;
  setThreadPinned: (threadId: string, isPinned: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string, options?: { adoptPanelTarget?: (replacementDraft: string) => void }) => Promise<void>;
}

interface ThreadCommandPanelScope {
  targetThreadId: string;
  initialActiveThreadId: string | null;
  initialTurnScopeRevision: ChatState["activeTurn"]["turnScopeRevision"];
  panelTarget: PanelTargetLease;
}

export function createThreadCommands(host: ThreadCommandsHost): ThreadCommands {
  return {
    compactActiveThread: () => compactActiveThread(host),
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown, beforeUnavailable) => archiveThread(host, threadId, saveMarkdown, beforeUnavailable),
    setThreadPinned: (threadId, isPinned) => setThreadPinned(host, threadId, isPinned),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId, options) => rollbackThread(host, threadId, options),
  };
}

async function compactActiveThread(host: ThreadCommandsHost): Promise<void> {
  const threadId = activeThreadId(threadCommandState(host));
  if (!threadId) {
    host.addSystemMessage("No active thread to compact.");
    return;
  }
  await compactThread(host, threadId);
}

async function compactThread(host: ThreadCommandsHost, threadId: string): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "compact")) return;
  const scope = captureThreadCommandPanelScope(host, threadId);
  try {
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    const effect = await host.effects.compactThread(threadId);
    if (!effectCompletedInCurrentContext(effect)) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(STATUS_COMPACTION_REQUESTED);
    host.setStatus(STATUS_COMPACTION_REQUESTED);
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(
  host: ThreadCommandsHost,
  threadId: string,
  saveMarkdown?: boolean,
  beforeUnavailable?: () => void,
): Promise<void> {
  await archiveThreadFromPanel(host, threadId, saveMarkdown, beforeUnavailable);
}

async function archiveThreadFromPanel(
  host: ThreadCommandsHost,
  threadId: string,
  saveMarkdown?: boolean,
  beforeUnavailable?: () => void,
): Promise<boolean> {
  if (host.threadPanelIsBusy(threadId)) {
    host.addSystemMessage("Finish or interrupt the thread before archiving it.");
    return false;
  }
  if (chatTurnBusy(threadCommandState(host).activeTurn)) {
    host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
    return false;
  }
  try {
    const options = {
      ...(saveMarkdown === undefined ? {} : { saveMarkdown }),
      ...(beforeUnavailable ? { beforePublish: beforeUnavailable } : {}),
    };
    return await host.mutations.archiveThread(threadId, options);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function forkThread(host: ThreadCommandsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

async function forkThreadFromTurn(
  host: ThreadCommandsHost,
  threadId: string,
  turnId: string | null,
  archiveSource: boolean,
): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "fork")) return;
  if (chatTurnBusy(threadCommandState(host).activeTurn)) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  const scope = captureThreadCommandPanelScope(host, threadId);

  const selectedTurnDistanceFromEnd = turnId
    ? threadStreamTurnsAfterTurnId(
        chatThreadStreamViewState(threadCommandState(host).threadStream, threadCommandState(host).activeTurn),
        turnId,
      )
    : 0;
  if (selectedTurnDistanceFromEnd === null) {
    host.addSystemMessage("Could not find the selected turn to fork.");
    return;
  }
  try {
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    const effect = turnId
      ? await host.effects.forkThread(threadId, { position: { kind: "through-turn", turnId } })
      : await host.effects.forkThread(threadId);
    if (!effectCompleted(effect)) return;
    const forkedThread = effect.value;
    const forkedThreadId = forkedThread.id;
    if (!effectCompletedInCurrentContext(effect) || !threadCommandScopeStillTargetsOriginalPanel(host, scope)) {
      host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
      return;
    }
    if (archiveSource) {
      let adoption: CurrentPanelAdoption;
      try {
        adoption = await host.openThreadInCurrentPanel(forkedThreadId, () => undefined);
      } catch (error) {
        host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
        if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel: ${message}`);
        return;
      }
      if (!adoption.adopted) {
        host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
        if (threadCommandScopeStillTargetsOriginalPanel(host, scope)) {
          host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel.`);
        }
        return;
      }
      await archiveReplacedSource(host, threadId, forkedThread, {
        failureMessage: "Forked the thread, but could not archive the previous version",
      });
      return;
    }
    host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
    try {
      await host.openThreadInNewView(forkedThreadId);
    } catch (error) {
      if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
      const message = error instanceof Error ? error.message : String(error);
      host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
    }
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function renameThread(host: ThreadCommandsHost, threadId: string, value: string): Promise<boolean> {
  try {
    const result = await host.mutations.renameThread(threadId, value);
    if (!result) return false;
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function setThreadPinned(host: ThreadCommandsHost, threadId: string, isPinned: boolean): Promise<void> {
  try {
    await host.mutations.setThreadPinned(threadId, isPinned);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function rollbackThread(
  host: ThreadCommandsHost,
  threadId: string,
  options: { adoptPanelTarget?: (replacementDraft: string) => void } = {},
): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "rollback")) return;
  if (chatTurnBusy(threadCommandState(host).activeTurn)) {
    host.addSystemMessage("Interrupt the current turn before rolling back.");
    return;
  }
  const scope = captureThreadCommandPanelScope(host, threadId);

  const current = threadCommandState(host);
  const candidate = threadStreamRollbackCandidate(chatThreadStreamViewState(current.threadStream, current.activeTurn));
  if (!candidate) {
    host.addSystemMessage("No completed turn to roll back.");
    return;
  }
  const runtime = activeThreadRuntimeState(threadCommandState(host).runtime);
  const runtimeOverrides = {
    ...(runtime.model ? { model: runtime.model } : {}),
    reasoningEffort: runtime.reasoningEffort,
    ...(runtime.serviceTierKnown ? { serviceTier: runtime.serviceTier } : {}),
    ...(runtime.approvalPolicyKnown && runtime.approvalPolicy ? { approvalPolicy: runtime.approvalPolicy } : {}),
    ...(runtime.approvalsReviewer ? { approvalsReviewer: runtime.approvalsReviewer } : {}),
    ...(runtime.permissionProfileKnown && runtime.activePermissionProfile
      ? { permissions: runtime.activePermissionProfile.id }
      : runtime.sandboxPolicyKnown && runtime.sandboxPolicy
        ? { sandboxPolicy: runtime.sandboxPolicy }
        : {}),
  };
  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    const effect = await host.effects.forkThread(threadId, {
      position: { kind: "before-turn", turnId: candidate.turnId },
      deferGoalContinuation: true,
      runtime: runtimeOverrides,
    });
    if (!effectCompleted(effect)) return;
    const forkedThread = effect.value;
    if (!effectCompletedInCurrentContext(effect)) return;
    if (!threadCommandScopeStillTargetsPanel(host, scope)) {
      host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
      return;
    }
    const onAdopted = () => {
      if (!options.adoptPanelTarget) host.setComposerText(candidate.text);
    };
    let adoption: CurrentPanelAdoption;
    try {
      adoption = options.adoptPanelTarget
        ? await host.openThreadInCurrentPanel(forkedThread.id, onAdopted, () => {
            options.adoptPanelTarget?.(candidate.text);
          })
        : await host.openThreadInCurrentPanel(forkedThread.id, onAdopted);
    } catch (error) {
      host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
      throw error;
    }
    if (!adoption.adopted) {
      host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
      if (threadCommandScopeStillTargetsPanel(host, scope)) {
        host.addSystemMessage("The rolled-back version was created but could not be opened in this panel. Open it from thread history.");
        host.setStatus(STATUS_ROLLBACK_FAILED);
      }
      return;
    }
    if (activeThreadId(threadCommandState(host)) === forkedThread.id) {
      host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
      host.setStatus(STATUS_ROLLBACK_COMPLETE);
    }
    await archiveReplacedSource(host, threadId, forkedThread, {
      saveMarkdown: false,
      failureMessage: "Rolled back the latest turn, but could not archive the previous version",
    });
  } catch (error) {
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus(STATUS_ROLLBACK_FAILED);
  }
}

async function archiveReplacedSource(
  host: ThreadCommandsHost,
  sourceThreadId: string,
  replacementThread: Thread,
  options: { readonly saveMarkdown?: boolean; readonly failureMessage: string },
): Promise<void> {
  try {
    const archiveOptions = {
      ...(options.saveMarkdown === undefined ? {} : { saveMarkdown: options.saveMarkdown }),
      additionalFacts: [{ type: "thread-upserted", thread: replacementThread }] satisfies readonly ThreadUpsertFact[],
    };
    if (await host.mutations.archiveThread(sourceThreadId, archiveOptions)) return;
    host.applyThreadFact({ type: "thread-upserted", thread: replacementThread });
    reportReplacementArchiveFailure(host, replacementThread.id, options.failureMessage, "archive was not completed");
  } catch (error) {
    host.applyThreadFact({ type: "thread-upserted", thread: replacementThread });
    const message = error instanceof Error ? error.message : String(error);
    reportReplacementArchiveFailure(host, replacementThread.id, options.failureMessage, message);
  }
}

function reportReplacementArchiveFailure(
  host: ThreadCommandsHost,
  replacementThreadId: string,
  failureMessage: string,
  detail: string,
): void {
  if (activeThreadId(threadCommandState(host)) !== replacementThreadId) return;
  host.addSystemMessage(`${failureMessage}: ${detail}`);
}

function activePanelOperationBlocked(host: ThreadCommandsHost, threadId: string, operation: ActivePanelOperation): boolean {
  const state = threadCommandState(host);
  if (activeThreadId(state) !== threadId) return false;
  const decision = activePanelOperationDecision(state, operation);
  if (decision.kind !== "blocked") return false;
  host.addSystemMessage(decision.message);
  return true;
}

function threadCommandState(host: ThreadCommandsHost): ChatState {
  return host.stateStore.getState();
}

function captureThreadCommandPanelScope(host: ThreadCommandsHost, targetThreadId: string): ThreadCommandPanelScope {
  return {
    targetThreadId,
    initialActiveThreadId: activeThreadId(threadCommandState(host)),
    initialTurnScopeRevision: threadCommandState(host).activeTurn.turnScopeRevision,
    panelTarget: capturePanelTargetLease(threadCommandState(host)),
  };
}

function threadCommandScopeStillTargetsPanel(host: ThreadCommandsHost, scope: ThreadCommandPanelScope): boolean {
  const state = threadCommandState(host);
  return (
    panelTargetLeaseIsCurrent(state, scope.panelTarget) &&
    activeThreadId(state) === scope.targetThreadId &&
    state.activeTurn.turnScopeRevision === scope.initialTurnScopeRevision
  );
}

function threadCommandScopeStillTargetsOriginalPanel(host: ThreadCommandsHost, scope: ThreadCommandPanelScope): boolean {
  const state = threadCommandState(host);
  if (!panelTargetLeaseIsCurrent(state, scope.panelTarget)) return false;
  if (!scope.initialActiveThreadId) return true;
  return scope.initialActiveThreadId === scope.targetThreadId && activeThreadId(state) === scope.targetThreadId;
}
