import type { AppServerClient } from "../../../../app-server/connection/client";
import { readThreadForArchiveExport, rollbackThread as rollbackThreadOnAppServer } from "../../../../app-server/services/threads";
import { inheritedForkThreadName, normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { CodexPanelSettings } from "../../../../settings/model";
import type { ArchiveExportAdapter } from "../../../thread-export/archive-markdown";
import { exportArchivedThreadMarkdown } from "../../../thread-export/archive-markdown";
import type { CodexChatHost } from "../ports/chat-host";
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
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../state/reducer";
import { resumedThreadActionFromActiveRuntime } from "./resume";

export interface ThreadManagementActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  archiveAdapter: () => ArchiveExportAdapter;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  showNotice: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export interface ThreadManagementActions {
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
}

export interface ThreadManagementActionsContext {
  obsidian: {
    archiveAdapter: () => ArchiveExportAdapter;
  };
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  notify: {
    showNotice: (text: string) => void;
  };
  thread: {
    selectThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

type RenameThreadHost = Pick<
  ThreadManagementActionsHost,
  "ensureConnected" | "currentClient" | "stateStore" | "addSystemMessage" | "notifyThreadRenamed"
>;

type ConnectedRenameThreadHost = Pick<
  ThreadManagementActionsHost,
  "currentClient" | "stateStore" | "addSystemMessage" | "notifyThreadRenamed"
>;

export function createThreadManagementActions(context: ThreadManagementActionsContext): ThreadManagementActions {
  const { obsidian, plugin, stateStore, client, status, notify, thread, composer } = context;
  const host: ThreadManagementActionsHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient: client.currentClient,
    addSystemMessage: status.addSystemMessage,
    showNotice: notify.showNotice,
    setStatus: status.set,
    setComposerText: composer.setText,
    openThreadInNewView: (threadId) => plugin.openThreadInNewView(threadId),
    openThreadInCurrentPanel: thread.selectThread,
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: (threadId, name) => {
      plugin.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshThreads: thread.refreshThreads,
    refreshSharedThreadListFromOpenSurface: () => {
      plugin.refreshSharedThreadListFromOpenSurface();
    },
  };

  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
  };
}

export async function compactThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
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

export async function archiveThread(
  host: ThreadManagementActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<void> {
  if (await archiveThreadOnServer(host, threadId, saveMarkdown)) {
    host.notifyThreadArchived(threadId);
  }
}

async function archiveThreadOnServer(
  host: ThreadManagementActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<boolean> {
  if (chatTurnBusy(threadManagementState(host))) {
    host.addSystemMessage(finishBeforeArchivingThreadsMessage());
    return false;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    const settings = host.settings();
    if (saveMarkdown) {
      const result = await exportArchivedThreadMarkdown(
        await readThreadForArchiveExport(client, threadId),
        { ...settings, vaultPath: host.vaultPath },
        host.archiveAdapter(),
      );
      host.showNotice(`Saved archived thread to ${result.path}.`);
    }
    await client.archiveThread(threadId);
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function forkThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

export async function forkThreadFromTurn(
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
        await client.setThreadName(forkedThreadId, sourceName);
        host.notifyThreadRenamed(forkedThreadId, sourceName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(forkNameCopyFailedMessage(forkedThreadId, message));
      }
    }
    if (archiveSource) {
      if (!(await archiveThreadOnServer(host, threadId))) return;
      try {
        await host.openThreadInCurrentPanel(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(archivedSourceOpenForkFailedMessage(threadId, forkedThreadId, message));
      }
      host.notifyThreadArchived(threadId);
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

export async function renameThread(host: RenameThreadHost, threadId: string, value: string): Promise<boolean> {
  const title = normalizeExplicitThreadName(value);
  if (!title) return false;

  await host.ensureConnected();
  return renameConnectedThread(host, threadId, title);
}

export async function renameConnectedThread(host: ConnectedRenameThreadHost, threadId: string, title: string): Promise<boolean> {
  const client = host.currentClient();
  if (!client) return false;

  try {
    await client.setThreadName(threadId, title);
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: host.stateStore
        .getState()
        .threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
    });
    host.notifyThreadRenamed(threadId, title);
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function rollbackThread(host: ThreadManagementActionsHost, threadId: string): Promise<void> {
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
    await host.refreshThreads();
    host.refreshSharedThreadListFromOpenSurface();
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
