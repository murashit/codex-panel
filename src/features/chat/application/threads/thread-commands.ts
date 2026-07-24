import { inheritedForkThreadName, type Thread } from "../../../../domain/threads/model";
import { activeThreadRuntimeState } from "../../domain/runtime/state";
import { effectCompleted, effectCompletedInCurrentContext } from "../effect-outcome";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamRollbackCandidate, threadStreamTurnsAfterTurnId } from "../state/thread-stream";
import { chatTurnBusy } from "../turns/turn-state";
import type { ThreadCommandPort } from "./thread-command-port";

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
const STATUS_ROLLBACK_STARTING = "Rolling back the latest turn...";
const STATUS_ROLLBACK_COMPLETE = "Rolled back the latest turn.";
const STATUS_ROLLBACK_FAILED = "Could not roll back the latest turn.";

export interface ThreadCommandsHost {
  stateStore: ChatStateStore;
  mutations: ThreadManagementMutations;
  commandPort: ThreadCommandPort;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<void>;
  openThreadInCurrentPanel: (threadId: string, onAdopted: () => void) => Promise<CurrentPanelAdoption>;
  beginThreadForkPublication: (sourceThreadId: string) => ThreadForkPublication;
  threadHasPendingOrRunningPanel: (threadId: string) => boolean;
}

type CurrentPanelAdoption =
  | { readonly adopted: false }
  | {
      readonly adopted: true;
      readonly activityPublication: { publish(commit: () => void): void };
    };

interface ThreadForkPublication {
  record(thread: Thread): void;
  finish(options?: { sourceArchived?: boolean }): void;
}

interface ThreadManagementMutations {
  renameThread(threadId: string, value: string): Promise<boolean>;
  archiveThread(threadId: string, options?: { saveMarkdown?: boolean }): Promise<boolean>;
}

export interface ThreadCommands {
  compactActiveThread: () => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
}

interface ThreadCommandPanelScope {
  targetThreadId: string;
  initialActiveThreadId: string | null;
  initialTurnLifecycle: ChatState["turn"]["lifecycle"];
  panelTarget: PanelTargetLease;
}

export function createThreadCommands(host: ThreadCommandsHost): ThreadCommands {
  return {
    compactActiveThread: () => compactActiveThread(host),
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
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
    if (!(await host.commandPort.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    const effect = await host.commandPort.compactThread(threadId);
    if (!effectCompletedInCurrentContext(effect)) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(STATUS_COMPACTION_REQUESTED);
    host.setStatus(STATUS_COMPACTION_REQUESTED);
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(host: ThreadCommandsHost, threadId: string, saveMarkdown?: boolean): Promise<void> {
  await archiveThreadFromPanel(host, threadId, saveMarkdown);
}

async function archiveThreadFromPanel(host: ThreadCommandsHost, threadId: string, saveMarkdown?: boolean): Promise<boolean> {
  if (host.threadHasPendingOrRunningPanel(threadId)) {
    host.addSystemMessage("Finish or interrupt the thread before archiving it.");
    return false;
  }
  if (chatTurnBusy(threadCommandState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
    return false;
  }
  try {
    const options = saveMarkdown === undefined ? {} : { saveMarkdown };
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
  if (chatTurnBusy(threadCommandState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  const scope = captureThreadCommandPanelScope(host, threadId);

  const selectedTurnDistanceFromEnd = turnId ? threadStreamTurnsAfterTurnId(threadCommandState(host).threadStream, turnId) : 0;
  if (selectedTurnDistanceFromEnd === null) {
    host.addSystemMessage("Could not find the selected turn to fork.");
    return;
  }
  let publication: ThreadForkPublication | null = null;
  let publicationFinished = false;
  let activityPublication: { publish(commit: () => void): void } | null = null;

  try {
    const sourceName = inheritedForkThreadName(threadId, threadCommandState(host).threadList.listedThreads);
    if (!(await host.commandPort.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    publication = host.beginThreadForkPublication(threadId);
    const effect = turnId
      ? await host.commandPort.forkThread(threadId, { position: { kind: "through-turn", turnId } })
      : await host.commandPort.forkThread(threadId);
    if (!effectCompleted(effect)) return;
    const forkedThread = effect.value;
    const forkedThreadId = forkedThread.id;
    publication.record(forkedThread);
    if (!effectCompletedInCurrentContext(effect)) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    if (sourceName) {
      try {
        if (!(await host.mutations.renameThread(forkedThreadId, sourceName))) return;
      } catch (error) {
        if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
      }
      if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    }
    if (archiveSource) {
      let adoption: CurrentPanelAdoption;
      try {
        adoption = await host.openThreadInCurrentPanel(forkedThreadId, () => undefined);
      } catch (error) {
        if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel: ${message}`);
        return;
      }
      if (!adoption.adopted) {
        if (threadCommandScopeStillTargetsOriginalPanel(host, scope)) {
          host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in the current panel.`);
        }
        return;
      }
      activityPublication = adoption.activityPublication;
      const sourceArchived = await archiveReplacedSource(host, threadId, forkedThreadId, {
        failureMessage: "Forked the thread, but could not archive the previous version",
      });
      activityPublication.publish(() => publication?.finish({ sourceArchived }));
      activityPublication = null;
      publicationFinished = true;
      return;
    }
    publication.finish();
    publicationFinished = true;
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
  } finally {
    if (!publicationFinished) {
      if (activityPublication) activityPublication.publish(() => publication?.finish());
      else publication?.finish();
    }
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

async function rollbackThread(host: ThreadCommandsHost, threadId: string): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "rollback")) return;
  if (chatTurnBusy(threadCommandState(host))) {
    host.addSystemMessage("Interrupt the current turn before rolling back.");
    return;
  }
  const scope = captureThreadCommandPanelScope(host, threadId);

  const candidate = threadStreamRollbackCandidate(threadCommandState(host).threadStream);
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
  let publication: ThreadForkPublication | null = null;
  let publicationFinished = false;
  let activityPublication: { publish(commit: () => void): void } | null = null;

  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    if (!(await host.commandPort.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    publication = host.beginThreadForkPublication(threadId);
    const effect = await host.commandPort.forkThread(threadId, {
      position: { kind: "before-turn", turnId: candidate.turnId },
      deferGoalContinuation: true,
      runtime: runtimeOverrides,
    });
    if (!effectCompleted(effect)) return;
    const forkedThread = effect.value;
    if (effectCompletedInCurrentContext(effect)) publication.record(forkedThread);
    else return;
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    const adoption = await host.openThreadInCurrentPanel(forkedThread.id, () => {
      host.setComposerText(candidate.text);
    });
    if (!adoption.adopted) {
      if (threadCommandScopeStillTargetsPanel(host, scope)) {
        host.addSystemMessage("The rolled-back version was created but could not be opened in this panel. Open it from thread history.");
        host.setStatus(STATUS_ROLLBACK_FAILED);
      }
      return;
    }
    activityPublication = adoption.activityPublication;
    if (activeThreadId(threadCommandState(host)) === forkedThread.id) {
      host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
      host.setStatus(STATUS_ROLLBACK_COMPLETE);
    }
    const sourceArchived = await archiveReplacedSource(host, threadId, forkedThread.id, {
      saveMarkdown: false,
      failureMessage: "Rolled back the latest turn, but could not archive the previous version",
    });
    activityPublication.publish(() => publication?.finish({ sourceArchived }));
    activityPublication = null;
    publicationFinished = true;
  } catch (error) {
    if (!threadCommandScopeStillTargetsPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus(STATUS_ROLLBACK_FAILED);
  } finally {
    if (!publicationFinished) {
      if (activityPublication) activityPublication.publish(() => publication?.finish());
      else publication?.finish();
    }
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
    initialTurnLifecycle: threadCommandState(host).turn.lifecycle,
    panelTarget: capturePanelTargetLease(threadCommandState(host)),
  };
}

function threadCommandScopeStillTargetsPanel(host: ThreadCommandsHost, scope: ThreadCommandPanelScope): boolean {
  const state = threadCommandState(host);
  return (
    panelTargetLeaseIsCurrent(state, scope.panelTarget) &&
    activeThreadId(state) === scope.targetThreadId &&
    state.turn.lifecycle === scope.initialTurnLifecycle
  );
}

function threadCommandScopeStillTargetsOriginalPanel(host: ThreadCommandsHost, scope: ThreadCommandPanelScope): boolean {
  const state = threadCommandState(host);
  if (!panelTargetLeaseIsCurrent(state, scope.panelTarget)) return false;
  if (!scope.initialActiveThreadId) return true;
  return scope.initialActiveThreadId === scope.targetThreadId && activeThreadId(state) === scope.targetThreadId;
}
