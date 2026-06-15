import type { AppServerClient } from "../../../../app-server/connection/client";
import { rollbackThread as rollbackThreadOnAppServer } from "../../../../app-server/services/threads";
import { inheritedForkThreadName } from "../../../../domain/threads/model";
import type { ThreadOperations } from "../../../threads/thread-operations";
import {
  archivedSourceOpenForkFailedMessage,
  finishBeforeArchivingThreadsMessage,
  finishBeforeForkingThreadsMessage,
  forkNameCopyFailedMessage,
  interruptBeforeRollbackMessage,
  noCompletedTurnToRollbackMessage,
  openForkInNewPanelFailedMessage,
  rollbackCompletedMessage,
  selectedTurnNotFoundForForkMessage,
  STATUS_COMPACTION_REQUESTED,
  STATUS_ROLLBACK_COMPLETE,
  STATUS_ROLLBACK_FAILED,
  STATUS_ROLLBACK_STARTING,
} from "./messages";
import { messageStreamItemsFromTurns } from "../../app-server/mappers/message-stream/turn-items";
import { messageStreamRollbackCandidate, messageStreamTurnsAfterTurnId } from "../state/message-stream";
import { chatTurnBusy, type ChatAction, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { resumedThreadActionFromActiveRuntime } from "./resume";

export interface ThreadManagementActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  operations: Pick<ThreadOperations, "archiveThread" | "renameThread">;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
  refreshAfterThreadMutation: () => Promise<void>;
}

export interface ThreadManagementActions {
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
}

export function createThreadManagementActions(host: ThreadManagementActionsHost): ThreadManagementActions {
  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
  };
}

async function compactThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;
  const initialActiveThreadId = threadManagementState(host).activeThread.id;
  try {
    await client.compactThread(threadId);
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
    const response = await client.forkThread(threadId, host.vaultPath);
    const forkedThreadId = response.thread.id;
    if (turnsToDrop > 0) {
      await client.rollbackThread(forkedThreadId, turnsToDrop);
    }
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
