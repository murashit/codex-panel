import type { AppServerClient } from "../../../../app-server/connection/client";
import { forkThread as forkThreadOnAppServer, rollbackThread as rollbackThreadOnAppServer } from "../../../../app-server/threads";
import { inheritedForkThreadName, type Thread } from "../../../../domain/threads/model";
import type { ThreadOperations } from "../../../threads/thread-operations";
import { messageStreamItemsFromTurns } from "../../app-server/mappers/message-stream/turn-items";
import { resumedThreadActionFromActiveRuntime } from "../state/actions";
import { messageStreamRollbackCandidate, messageStreamTurnsAfterTurnId } from "../state/message-stream";
import { chatTurnBusy, type ChatAction, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
const STATUS_ROLLBACK_STARTING = "Rolling back latest turn...";
const STATUS_ROLLBACK_COMPLETE = "Rolled back latest turn.";
const STATUS_ROLLBACK_FAILED = "Rollback failed.";

export interface ThreadManagementActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  operations: ThreadOperations;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
  refreshAfterThreadMutation: () => Promise<void>;
  recordForkedThread: (thread: Thread) => void;
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

function finishBeforeArchivingThreadsMessage(): string {
  return "Finish or interrupt the current turn before archiving threads.";
}

function finishBeforeForkingThreadsMessage(): string {
  return "Finish or interrupt the current turn before forking threads.";
}

function selectedTurnNotFoundForForkMessage(): string {
  return "Could not find the selected turn to fork.";
}

function forkNameCopyFailedMessage(threadId: string, message: string): string {
  return `Forked thread ${threadId}, but could not copy the source thread name: ${message}`;
}

function archivedSourceOpenForkFailedMessage(sourceThreadId: string, forkedThreadId: string, message: string): string {
  return `Archived thread ${sourceThreadId}, but could not open forked thread ${forkedThreadId}: ${message}`;
}

function openForkInNewPanelFailedMessage(forkedThreadId: string, message: string): string {
  return `Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`;
}

function interruptBeforeRollbackMessage(): string {
  return "Interrupt the current turn before rolling back.";
}

function noCompletedTurnToRollbackMessage(): string {
  return "No completed turn to roll back.";
}

function noActiveThreadToCompactMessage(): string {
  return "No active thread to compact.";
}

function rollbackCompletedMessage(): string {
  return "Rolled back the latest turn. Local file changes were not reverted.";
}

async function compactActiveThread(host: ThreadManagementActionsHost): Promise<void> {
  const threadId = threadManagementState(host).activeThread.id;
  if (!threadId) {
    host.addSystemMessage(noActiveThreadToCompactMessage());
    return;
  }
  await compactThread(host, threadId);
}

async function compactThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;
  const initialActiveThreadId = threadManagementState(host).activeThread.id;
  try {
    await client.compactThread(threadId);
    if (host.currentClient() !== client) return;
    if (!threadManagementStillTargetsOriginalPanel(threadManagementState(host), initialActiveThreadId, threadId)) return;
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
    host.addSystemMessage(finishBeforeArchivingThreadsMessage());
    return false;
  }
  try {
    const options = saveMarkdown === undefined ? {} : { saveMarkdown };
    return Boolean(await host.operations.archiveThread(threadId, options));
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
    host.addSystemMessage(finishBeforeForkingThreadsMessage());
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const initialActiveThreadId = threadManagementState(host).activeThread.id;
  const turnsToDrop = turnId ? messageStreamTurnsAfterTurnId(threadManagementState(host).messageStream, turnId) : 0;
  if (turnsToDrop === null) {
    host.addSystemMessage(selectedTurnNotFoundForForkMessage());
    return;
  }

  try {
    const sourceName = inheritedForkThreadName(threadId, threadManagementState(host).threadList.listedThreads);
    const forkedThread = await forkThreadOnAppServer(client, threadId, host.vaultPath);
    if (host.currentClient() !== client) return;
    const forkedThreadId = forkedThread.id;
    if (turnsToDrop > 0) {
      await rollbackThreadOnAppServer(client, forkedThreadId, turnsToDrop);
      if (host.currentClient() !== client) return;
    }
    host.recordForkedThread(forkedThread);
    if (!threadManagementStillTargetsOriginalPanel(threadManagementState(host), initialActiveThreadId, threadId)) return;
    if (sourceName) {
      try {
        if (!(await host.operations.renameThread(forkedThreadId, sourceName))) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(forkNameCopyFailedMessage(forkedThreadId, message));
      }
    }
    if (archiveSource) {
      if (!(await archiveThreadFromPanel(host, threadId))) return;
      try {
        await host.openThreadInCurrentPanel(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(archivedSourceOpenForkFailedMessage(threadId, forkedThreadId, message));
      }
      return;
    }
    try {
      await host.openThreadInNewView(forkedThreadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.addSystemMessage(openForkInNewPanelFailedMessage(forkedThreadId, message));
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
    host.addSystemMessage(interruptBeforeRollbackMessage());
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const candidate = messageStreamRollbackCandidate(threadManagementState(host).messageStream);
  if (!candidate) {
    host.addSystemMessage(noCompletedTurnToRollbackMessage());
    return;
  }

  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    const snapshot = await rollbackThreadOnAppServer(client, threadId);
    if (host.currentClient() !== client) return;
    if (!threadManagementStillTargetsPanel(threadManagementState(host), threadId)) return;
    threadManagementDispatch(
      host,
      resumedThreadActionFromActiveRuntime({
        thread: snapshot.thread,
        cwd: snapshot.cwd,
        runtime: threadManagementState(host).runtime,
        listedThreads: threadManagementState(host).threadList.listedThreads,
      }),
    );
    threadManagementDispatch(host, {
      type: "message-stream/items-replaced",
      items: messageStreamItemsFromTurns(snapshot.turns),
      historyCursor: null,
      loadingHistory: false,
    });
    host.setComposerText(candidate.text);
    host.addSystemMessage(rollbackCompletedMessage());
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

function threadManagementStillTargetsPanel(state: ChatState, threadId: string): boolean {
  return state.activeThread.id === threadId;
}

function threadManagementStillTargetsOriginalPanel(state: ChatState, initialThreadId: string | null, threadId: string): boolean {
  if (!initialThreadId) return true;
  return initialThreadId === threadId && state.activeThread.id === threadId;
}
