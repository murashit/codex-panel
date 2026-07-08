import { inheritedForkThreadName, type Thread } from "../../../../domain/threads/model";
import { activeThreadRuntimeState } from "../../domain/runtime/state";
import { resumedThreadActionFromActiveRuntime } from "../state/actions";
import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamRollbackCandidate, threadStreamTurnsAfterTurnId } from "../state/thread-stream";
import { chatTurnBusy } from "../turns/turn-state";
import type { ThreadMutationTransport } from "./thread-mutation-transport";

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
const STATUS_ROLLBACK_STARTING = "Rolling back the latest turn...";
const STATUS_ROLLBACK_COMPLETE = "Rolled back the latest turn.";
const STATUS_ROLLBACK_FAILED = "Could not roll back the latest turn.";

export interface ThreadManagementActionsHost {
  stateStore: ChatStateStore;
  operations: ThreadManagementOperations;
  threadTransport: ThreadMutationTransport;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<void>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
  refreshAfterThreadMutation: () => Promise<void>;
  recordForkedThread: (thread: Thread) => void;
}

interface ThreadManagementOperations {
  renameThread(threadId: string, value: string): Promise<boolean>;
  archiveThread(threadId: string, options?: { saveMarkdown?: boolean }): Promise<boolean>;
}

export interface ThreadManagementActions {
  compactActiveThread: () => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
}

interface ThreadManagementPanelScope {
  targetThreadId: string;
  initialActiveThreadId: string | null;
}

export function createThreadManagementActions(host: ThreadManagementActionsHost): ThreadManagementActions {
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

async function compactActiveThread(host: ThreadManagementActionsHost): Promise<void> {
  const threadId = threadManagementState(host).activeThread.id;
  if (!threadId) {
    host.addSystemMessage("No active thread to compact.");
    return;
  }
  await compactThread(host, threadId);
}

async function compactThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  const scope = captureThreadManagementPanelScope(host, threadId);
  try {
    if (!(await host.threadTransport.compactThread(threadId))) return;
    if (!threadManagementScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(STATUS_COMPACTION_REQUESTED);
    host.setStatus(STATUS_COMPACTION_REQUESTED);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(host: ThreadManagementActionsHost, threadId: string, saveMarkdown?: boolean): Promise<void> {
  await archiveThreadFromPanel(host, threadId, saveMarkdown);
}

async function archiveThreadFromPanel(host: ThreadManagementActionsHost, threadId: string, saveMarkdown?: boolean): Promise<boolean> {
  if (chatTurnBusy(threadManagementState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
    return false;
  }
  try {
    const options = saveMarkdown === undefined ? {} : { saveMarkdown };
    return await host.operations.archiveThread(threadId, options);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function forkThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

async function forkThreadFromTurn(
  host: ThreadManagementActionsHost,
  threadId: string,
  turnId: string | null,
  archiveSource: boolean,
): Promise<void> {
  if (chatTurnBusy(threadManagementState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  const scope = captureThreadManagementPanelScope(host, threadId);

  const selectedTurnDistanceFromEnd = turnId ? threadStreamTurnsAfterTurnId(threadManagementState(host).threadStream, turnId) : 0;
  if (selectedTurnDistanceFromEnd === null) {
    host.addSystemMessage("Could not find the selected turn to fork.");
    return;
  }

  try {
    const sourceName = inheritedForkThreadName(threadId, threadManagementState(host).threadList.listedThreads);
    const forkedThread = turnId ? await host.threadTransport.forkThread(threadId, turnId) : await host.threadTransport.forkThread(threadId);
    if (!forkedThread) return;
    const forkedThreadId = forkedThread.id;
    host.recordForkedThread(forkedThread);
    if (!threadManagementScopeStillTargetsOriginalPanel(host, scope)) return;
    if (sourceName) {
      try {
        if (!(await host.operations.renameThread(forkedThreadId, sourceName))) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
      }
    }
    if (archiveSource) {
      if (!(await archiveThreadFromPanel(host, threadId))) return;
      try {
        await host.openThreadInCurrentPanel(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Archived thread ${threadId}, but could not open forked thread ${forkedThreadId}: ${message}`);
      }
      return;
    }
    try {
      await host.openThreadInNewView(forkedThreadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
    }
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function renameThread(host: ThreadManagementActionsHost, threadId: string, value: string): Promise<boolean> {
  try {
    const result = await host.operations.renameThread(threadId, value);
    if (!result) return false;
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function rollbackThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  if (chatTurnBusy(threadManagementState(host))) {
    host.addSystemMessage("Interrupt the current turn before rolling back.");
    return;
  }
  const scope = captureThreadManagementPanelScope(host, threadId);

  const candidate = threadStreamRollbackCandidate(threadManagementState(host).threadStream);
  if (!candidate) {
    host.addSystemMessage("No completed turn to roll back.");
    return;
  }

  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    const snapshot = await host.threadTransport.rollbackThread(threadId);
    if (!snapshot) return;
    if (!threadManagementScopeStillTargetsPanel(host, scope)) return;
    threadManagementDispatch(
      host,
      resumedThreadActionFromActiveRuntime({
        thread: snapshot.thread,
        cwd: snapshot.cwd,
        runtime: activeThreadRuntimeState(threadManagementState(host).runtime),
        listedThreads: threadManagementState(host).threadList.listedThreads,
      }),
    );
    threadManagementDispatch(host, {
      type: "thread-stream/items-replaced",
      items: snapshot.items,
      historyCursor: null,
      loadingHistory: false,
    });
    host.setComposerText(candidate.text);
    host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
    host.setStatus(STATUS_ROLLBACK_COMPLETE);
    host.notifyActiveThreadIdentityChanged();
    await host.refreshAfterThreadMutation();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus(STATUS_ROLLBACK_FAILED);
  }
}

function threadManagementState(host: ThreadManagementActionsHost): ChatState {
  return host.stateStore.getState();
}

function threadManagementDispatch(host: ThreadManagementActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

function captureThreadManagementPanelScope(host: ThreadManagementActionsHost, targetThreadId: string): ThreadManagementPanelScope {
  return {
    targetThreadId,
    initialActiveThreadId: threadManagementState(host).activeThread.id,
  };
}

function threadManagementScopeStillTargetsPanel(host: ThreadManagementActionsHost, scope: ThreadManagementPanelScope): boolean {
  return threadManagementState(host).activeThread.id === scope.targetThreadId;
}

function threadManagementScopeStillTargetsOriginalPanel(host: ThreadManagementActionsHost, scope: ThreadManagementPanelScope): boolean {
  if (!scope.initialActiveThreadId) return true;
  return scope.initialActiveThreadId === scope.targetThreadId && threadManagementState(host).activeThread.id === scope.targetThreadId;
}
