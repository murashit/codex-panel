import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { Thread } from "../../../../domain/threads/model";
import { activeThreadRuntimeState } from "../../domain/runtime/state";
import type { EffectOutcome } from "../effect-outcome";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { threadStreamRollbackCandidate, threadStreamTurnsAfterTurnId } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import type { ComposerSubmissionAdoption } from "../submission/input-claim";
import { chatTurnBusy } from "../turns/turn-state";
import { captureForkDisplaySnapshot, type ForkDisplaySnapshot } from "./fork-display-snapshot";

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
  openThreadInNewView: (threadId: string, displaySnapshot: ForkDisplaySnapshot) => Promise<void>;
  openThreadInCurrentPanel: (threadId: string, displaySnapshot: ForkDisplaySnapshot) => Promise<boolean>;
  beginThreadReplacementPublication: (sourceThreadId: string) => ThreadReplacementPublication;
  applyThreadFact: (fact: ThreadUpsertFact) => void;
}

interface ThreadUpsertFact {
  readonly type: "thread-upserted";
  readonly thread: Thread;
}

interface ThreadReplacementPublication {
  attach(replacementThread: Thread): void;
  finish(sourceArchived: boolean): void;
}

interface ThreadManagementMutations {
  renameThread(threadId: string, value: string): Promise<boolean>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(threadId: string, options?: { saveMarkdown?: boolean; afterArchive?: () => void }): Promise<boolean>;
}

export interface ThreadCommands {
  compactActiveThread: () => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean, afterArchive?: () => void) => Promise<void>;
  setThreadPinned: (threadId: string, isPinned: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string, options?: { adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"] }) => Promise<void>;
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
    archiveThread: (threadId, saveMarkdown, afterArchive) => archiveThread(host, threadId, saveMarkdown, afterArchive),
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
    if (effect.kind === "not-started") return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(STATUS_COMPACTION_REQUESTED);
    host.setStatus(STATUS_COMPACTION_REQUESTED);
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(host: ThreadCommandsHost, threadId: string, saveMarkdown?: boolean, afterArchive?: () => void): Promise<void> {
  await archiveThreadFromPanel(host, threadId, saveMarkdown, afterArchive);
}

async function archiveThreadFromPanel(
  host: ThreadCommandsHost,
  threadId: string,
  saveMarkdown?: boolean,
  afterArchive?: () => void,
): Promise<boolean> {
  try {
    const options = {
      ...(saveMarkdown === undefined ? {} : { saveMarkdown }),
      ...(afterArchive ? { afterArchive } : {}),
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
  const displaySnapshot = captureForkDisplaySnapshot(
    chatThreadStreamViewState(threadCommandState(host).threadStream, threadCommandState(host).activeTurn),
    turnId ? { kind: "through-turn", turnId } : { kind: "latest" },
  );

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
  let publication: ThreadReplacementPublication | null = null;
  try {
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    if (archiveSource) publication = host.beginThreadReplacementPublication(threadId);
    const effect = turnId
      ? await host.effects.forkThread(threadId, { position: { kind: "through-turn", turnId } })
      : await host.effects.forkThread(threadId);
    if (effect.kind === "not-started") return;
    const forkedThread = effect.value;
    const forkedThreadId = forkedThread.id;
    publication?.attach(forkedThread);
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) {
      if (!publication) host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
      return;
    }
    if (archiveSource) {
      if (!publication) throw new Error("Thread replacement publication was not started.");
      try {
        await finishThreadReplacement(publication, async () => {
          let adopted: boolean;
          try {
            adopted = await host.openThreadInCurrentPanel(forkedThreadId, displaySnapshot);
          } catch (error) {
            if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return false;
            const message = error instanceof Error ? error.message : String(error);
            host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel: ${message}`);
            return false;
          }
          if (!adopted) {
            if (threadCommandScopeStillTargetsOriginalPanel(host, scope)) {
              host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel.`);
            }
            return false;
          }
          return archiveReplacedSource(host, threadId, forkedThread.id, {
            failureMessage: "Forked the thread, but could not archive the previous version",
          });
        });
      } finally {
        publication = null;
      }
      return;
    }
    host.applyThreadFact({ type: "thread-upserted", thread: forkedThread });
    try {
      await host.openThreadInNewView(forkedThreadId, displaySnapshot);
    } catch (error) {
      if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
      const message = error instanceof Error ? error.message : String(error);
      host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
    }
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  } finally {
    publication?.finish(false);
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
  options: { adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"] } = {},
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
  const displaySnapshot = captureForkDisplaySnapshot(chatThreadStreamViewState(current.threadStream, current.activeTurn), {
    kind: "before-turn",
    turnId: candidate.turnId,
  });
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
  let publication: ThreadReplacementPublication | null = null;
  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    publication = host.beginThreadReplacementPublication(threadId);
    const effect = await host.effects.forkThread(threadId, {
      position: { kind: "before-turn", turnId: candidate.turnId },
      deferGoalContinuation: true,
      runtime: runtimeOverrides,
    });
    if (effect.kind === "not-started") return;
    const forkedThread = effect.value;
    publication.attach(forkedThread);
    if (!threadCommandScopeStillTargetsPanel(host, scope)) {
      return;
    }
    try {
      await finishThreadReplacement(publication, async () => {
        options.adoptPanelTarget?.(forkedThread.id, candidate.text);
        const adopted = await host.openThreadInCurrentPanel(forkedThread.id, displaySnapshot);
        if (!adopted) {
          if (threadCommandScopeStillTargetsPanel(host, scope)) {
            host.addSystemMessage(
              "The rolled-back version was created but could not be opened in this panel. Open it from thread history.",
            );
            host.setStatus(STATUS_ROLLBACK_FAILED);
          }
          return false;
        }
        if (!options.adoptPanelTarget) host.setComposerText(candidate.text);
        if (activeThreadId(threadCommandState(host)) === forkedThread.id) {
          host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
          host.setStatus(STATUS_ROLLBACK_COMPLETE);
        }
        return archiveReplacedSource(host, threadId, forkedThread.id, {
          saveMarkdown: false,
          failureMessage: "Rolled back the latest turn, but could not archive the previous version",
        });
      });
    } finally {
      publication = null;
    }
  } catch (error) {
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus(STATUS_ROLLBACK_FAILED);
  } finally {
    publication?.finish(false);
  }
}

async function archiveReplacedSource(
  host: ThreadCommandsHost,
  sourceThreadId: string,
  replacementThreadId: string,
  options: { readonly saveMarkdown?: boolean; readonly failureMessage: string },
): Promise<boolean> {
  try {
    const archiveOptions = options.saveMarkdown === undefined ? {} : { saveMarkdown: options.saveMarkdown };
    if (await host.mutations.archiveThread(sourceThreadId, archiveOptions)) return true;
    reportReplacementArchiveFailure(host, replacementThreadId, options.failureMessage, "archive was not completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportReplacementArchiveFailure(host, replacementThreadId, options.failureMessage, message);
  }
  return false;
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

async function finishThreadReplacement(publication: ThreadReplacementPublication, replace: () => Promise<boolean>): Promise<void> {
  let sourceArchived = false;
  try {
    sourceArchived = await replace();
  } finally {
    publication.finish(sourceArchived);
  }
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
