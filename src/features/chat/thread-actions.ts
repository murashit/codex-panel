import { Notice } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { exportArchivedThreadMarkdown } from "../../domain/threads/export";
import { inheritedForkThreadName, upsertThread } from "../../domain/threads/model";
import type { CodexPanelSettings } from "../../settings/model";
import type { ArchiveExportAdapter } from "../../domain/threads/export";
import type { ChatState } from "./chat-state";
import type { ThreadHistoryLoader } from "./thread-history";
import { rollbackCandidateFromItems } from "./rollback";

export interface ChatThreadActionControllerHost {
  state: ChatState;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  archiveAdapter: () => ArchiveExportAdapter;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  history: ThreadHistoryLoader;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export class ChatThreadActionController {
  constructor(private readonly host: ChatThreadActionControllerHost) {}

  async archiveThread(threadId: string, saveMarkdown = this.host.settings().archiveExportEnabled): Promise<void> {
    if (this.host.state.busy) {
      this.host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
      return;
    }
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const settings = this.host.settings();
      if (saveMarkdown) {
        const response = await client.readThread(threadId, true);
        const result = await exportArchivedThreadMarkdown(response.thread, settings, this.host.archiveAdapter());
        new Notice(`Saved archived thread to ${result.path}.`);
      }
      await client.archiveThread(threadId);
      this.host.notifyThreadArchived(threadId);
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async forkThread(threadId: string): Promise<void> {
    if (this.host.state.busy) {
      this.host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
      return;
    }
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    try {
      const sourceName = inheritedForkThreadName(threadId, this.host.state.listedThreads);
      const response = await client.forkThread(threadId, this.host.vaultPath);
      const forkedThreadId = response.thread.id;
      if (sourceName) {
        try {
          await client.setThreadName(forkedThreadId, sourceName);
          this.host.notifyThreadRenamed(forkedThreadId, sourceName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
        }
      }
      try {
        await this.host.openThreadInNewView(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
      }
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async rollbackThread(threadId: string): Promise<void> {
    if (this.host.state.busy) {
      this.host.addSystemMessage("Interrupt the current turn before rolling back.");
      return;
    }
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    const candidate = rollbackCandidateFromItems(this.host.state.displayItems);
    if (!candidate) {
      this.host.addSystemMessage("No completed turn to roll back.");
      return;
    }

    try {
      this.host.setStatus("Rolling back latest turn...");
      const response = await client.rollbackThread(threadId);
      this.host.state.activeThreadId = response.thread.id;
      this.host.state.activeThreadCwd = response.thread.cwd;
      this.host.state.activeTurnId = null;
      this.host.state.tokenUsage = null;
      this.host.state.historyCursor = null;
      this.host.state.turnDiffs.clear();
      this.host.state.listedThreads = upsertThread(this.host.state.listedThreads, response.thread);
      await this.host.history.loadLatest(response.thread.id);
      this.host.setComposerText(candidate.text);
      this.host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
      this.host.setStatus("Rolled back latest turn.");
      this.host.notifyActiveThreadIdentityChanged();
      await this.host.refreshThreads();
      this.host.refreshSharedThreadListFromOpenSurface();
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      this.host.setStatus("Rollback failed.");
    }
  }
}
