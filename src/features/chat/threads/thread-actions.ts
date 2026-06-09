import { Notice } from "obsidian";

import type { AppServerClient } from "../../../app-server/client";
import { threadFromAppServerThread } from "../../../app-server/thread-model";
import { exportArchivedThreadMarkdown } from "../../../domain/threads/export";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import { inheritedForkThreadName } from "../../../domain/threads/model";
import type { CodexPanelSettings } from "../../../settings/model";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../chat-state";
import { rollbackCandidateFromItems, turnsAfterTurnId } from "../display/action-candidates";
import { displayItemsFromTurns } from "../display/thread-items";
import { resumedThreadActionFromActiveRuntime } from "./thread-resume";

export interface ChatThreadActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  archiveAdapter: () => ArchiveExportAdapter;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  forceRenderSlots: () => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export interface ChatThreadActions {
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
}

export function createChatThreadActions(host: ChatThreadActionsHost): ChatThreadActions {
  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
  };
}

async function compactThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;
  try {
    await client.compactThread(threadId);
    host.addSystemMessage("Compaction requested.");
    host.setStatus("Compaction requested.");
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(
  host: ChatThreadActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<void> {
  if (await archiveThreadOnServer(host, threadId, saveMarkdown)) {
    host.notifyThreadArchived(threadId);
  }
}

async function archiveThreadOnServer(
  host: ChatThreadActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<boolean> {
  if (chatTurnBusy(state(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
    return false;
  }
  const client = host.currentClient();
  if (!client) return false;
  try {
    const settings = host.settings();
    if (saveMarkdown) {
      const response = await client.readThread(threadId, true);
      const result = await exportArchivedThreadMarkdown(
        { ...threadFromAppServerThread(response.thread, { archived: true }), turns: response.thread.turns },
        { ...settings, vaultPath: host.vaultPath },
        host.archiveAdapter(),
      );
      new Notice(`Saved archived thread to ${result.path}.`);
    }
    await client.archiveThread(threadId);
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function forkThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

async function forkThreadFromTurn(
  host: ChatThreadActionsHost,
  threadId: string,
  turnId: string | null,
  archiveSource: boolean,
): Promise<void> {
  if (chatTurnBusy(state(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const turnsToDrop = turnId ? turnsAfterTurnId(state(host).transcript.displayItems, turnId) : 0;
  if (turnsToDrop === null) {
    host.addSystemMessage("Could not find the selected turn to fork.");
    return;
  }

  try {
    const sourceName = inheritedForkThreadName(threadId, state(host).threadList.listedThreads);
    const response = await client.forkThread(threadId, host.vaultPath);
    const forkedThreadId = response.thread.id;
    if (turnsToDrop > 0) {
      await client.rollbackThread(forkedThreadId, turnsToDrop);
    }
    if (sourceName) {
      try {
        await client.setThreadName(forkedThreadId, sourceName);
        host.notifyThreadRenamed(forkedThreadId, sourceName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
      }
    }
    if (archiveSource) {
      if (!(await archiveThreadOnServer(host, threadId))) return;
      try {
        await host.openThreadInCurrentPanel(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Archived thread ${threadId}, but could not open forked thread ${forkedThreadId}: ${message}`);
      }
      host.notifyThreadArchived(threadId);
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

async function rollbackThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  if (chatTurnBusy(state(host))) {
    host.addSystemMessage("Interrupt the current turn before rolling back.");
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const candidate = rollbackCandidateFromItems(state(host).transcript.displayItems);
  if (!candidate) {
    host.addSystemMessage("No completed turn to roll back.");
    return;
  }

  try {
    host.setStatus("Rolling back latest turn...");
    const response = await client.rollbackThread(threadId);
    const thread = threadFromAppServerThread(response.thread);
    dispatch(
      host,
      resumedThreadActionFromActiveRuntime({
        thread,
        cwd: response.thread.cwd,
        runtime: state(host).runtime,
        listedThreads: state(host).threadList.listedThreads,
      }),
    );
    dispatch(host, {
      type: "transcript/items-replaced",
      items: displayItemsFromTurns(response.thread.turns),
      historyCursor: null,
      loadingHistory: false,
    });
    host.setComposerText(candidate.text);
    host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
    host.forceRenderSlots();
    host.setStatus("Rolled back latest turn.");
    host.notifyActiveThreadIdentityChanged();
    await host.refreshThreads();
    host.refreshSharedThreadListFromOpenSurface();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus("Rollback failed.");
  }
}

function state(host: ChatThreadActionsHost): ChatState {
  return host.stateStore.getState();
}

function dispatch(host: ChatThreadActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}
