import type { AppServerClient } from "../../../../app-server/connection/client";
import { forkThread as forkThreadOnAppServer, rollbackThread as rollbackThreadOnAppServer } from "../../../../app-server/threads";
import { inheritedForkThreadName } from "../../../../domain/threads/model";
import type { ThreadCatalogEvent } from "../../../../workspace/thread-catalog";
import type { ThreadOperations } from "../../../threads/thread-operations";
import { messageStreamItemsFromTurns } from "../../app-server/mappers/message-stream/turn-items";
import { activeThreadRuntimeState } from "../../domain/runtime/state";
import { chatTurnBusy } from "../conversation/turn-state";
import { resumedThreadActionFromActiveRuntime } from "../state/actions";
import { messageStreamRollbackCandidate, messageStreamTurnsAfterTurnId } from "../state/message-stream";
import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
const STATUS_ROLLBACK_STARTING = "Rolling back latest turn...";
const STATUS_ROLLBACK_COMPLETE = "Rolled back latest turn.";
const STATUS_ROLLBACK_FAILED = "Rollback failed.";

export interface ThreadManagementActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  operations: ThreadOperations;
  connectedClient: () => Promise<AppServerClient | null>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
  refreshAfterThreadMutation: () => Promise<void>;
  applyThreadCatalogEvent: (event: ThreadCatalogEvent) => void;
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

interface ThreadManagementActionScope {
  client: AppServerClient;
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
  const scope = await captureThreadManagementActionScope(host, threadId);
  if (!scope) return;
  try {
    await scope.client.compactThread(threadId);
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
  const scope = await captureThreadManagementActionScope(host, threadId);
  if (!scope) return;

  const turnsToDrop = turnId ? messageStreamTurnsAfterTurnId(threadManagementState(host).messageStream, turnId) : 0;
  if (turnsToDrop === null) {
    host.addSystemMessage(selectedTurnNotFoundForForkMessage());
    return;
  }

  try {
    const sourceName = inheritedForkThreadName(threadId, threadManagementState(host).threadList.listedThreads);
    const forkedThread = await forkThreadOnAppServer(scope.client, threadId, host.vaultPath);
    if (threadManagementScopeClientStale(host, scope)) return;
    const forkedThreadId = forkedThread.id;
    if (turnsToDrop > 0) {
      await rollbackThreadOnAppServer(scope.client, forkedThreadId, turnsToDrop);
      if (threadManagementScopeClientStale(host, scope)) return;
    }
    host.applyThreadCatalogEvent({ type: "thread-forked", thread: forkedThread });
    if (!threadManagementScopeStillTargetsOriginalPanel(host, scope)) return;
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
  const scope = await captureThreadManagementActionScope(host, threadId);
  if (!scope) return;

  const candidate = messageStreamRollbackCandidate(threadManagementState(host).messageStream);
  if (!candidate) {
    host.addSystemMessage(noCompletedTurnToRollbackMessage());
    return;
  }

  try {
    host.setStatus(STATUS_ROLLBACK_STARTING);
    const snapshot = await rollbackThreadOnAppServer(scope.client, threadId);
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

async function captureThreadManagementActionScope(
  host: ThreadManagementActionsHost,
  targetThreadId: string,
): Promise<ThreadManagementActionScope | null> {
  const client = await host.connectedClient();
  if (!client) return null;
  return {
    client,
    targetThreadId,
    initialActiveThreadId: threadManagementState(host).activeThread.id,
  };
}

function threadManagementScopeClientStale(host: ThreadManagementActionsHost, scope: ThreadManagementActionScope): boolean {
  return host.currentClient() !== scope.client;
}

function threadManagementScopeStillTargetsPanel(host: ThreadManagementActionsHost, scope: ThreadManagementActionScope): boolean {
  return !threadManagementScopeClientStale(host, scope) && threadManagementState(host).activeThread.id === scope.targetThreadId;
}

function threadManagementScopeStillTargetsOriginalPanel(host: ThreadManagementActionsHost, scope: ThreadManagementActionScope): boolean {
  if (threadManagementScopeClientStale(host, scope)) return false;
  if (!scope.initialActiveThreadId) return true;
  return scope.initialActiveThreadId === scope.targetThreadId && threadManagementState(host).activeThread.id === scope.targetThreadId;
}
