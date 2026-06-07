import { Notice } from "obsidian";

import type { AppServerClient } from "../../../../app-server/client";
import { exportArchivedThreadMarkdown } from "../../../../domain/threads/export";
import type { ArchiveExportAdapter } from "../../../../domain/threads/export";
import { inheritedForkThreadName, upsertThread } from "../../../../domain/threads/model";
import type { CodexPanelSettings } from "../../../../settings/model";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../../chat-state";
import { turnsAfterTurnId } from "../../fork";
import { rollbackCandidateFromItems } from "../../rollback";
import type { ThreadHistoryLoader } from "../../thread-history";

export interface ChatThreadActionControllerHost {
  stateStore: ChatStateStore;
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
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export class ChatThreadActionController {
  constructor(private readonly host: ChatThreadActionControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  async compactThread(threadId: string): Promise<void> {
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;
    try {
      await client.compactThread(threadId);
      this.host.addSystemMessage("Compaction requested.");
      this.host.setStatus("Compaction requested.");
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async archiveThread(threadId: string, saveMarkdown = this.host.settings().archiveExportEnabled): Promise<void> {
    if (await this.archiveThreadOnServer(threadId, saveMarkdown)) {
      this.host.notifyThreadArchived(threadId);
    }
  }

  private async archiveThreadOnServer(threadId: string, saveMarkdown = this.host.settings().archiveExportEnabled): Promise<boolean> {
    if (chatTurnBusy(this.state)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
      return false;
    }
    const client = this.host.currentClient();
    if (!client) return false;
    try {
      const settings = this.host.settings();
      if (saveMarkdown) {
        const response = await client.readThread(threadId, true);
        const result = await exportArchivedThreadMarkdown(
          response.thread,
          { ...settings, vaultPath: this.host.vaultPath },
          this.host.archiveAdapter(),
        );
        new Notice(`Saved archived thread to ${result.path}.`);
      }
      await client.archiveThread(threadId);
      return true;
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async forkThread(threadId: string): Promise<void> {
    await this.forkThreadFromTurn(threadId, null, false);
  }

  async forkThreadFromTurn(threadId: string, turnId: string | null, archiveSource: boolean): Promise<void> {
    if (chatTurnBusy(this.state)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
      return;
    }
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    const turnsToDrop = turnId ? turnsAfterTurnId(this.state.transcript.displayItems, turnId) : 0;
    if (turnsToDrop === null) {
      this.host.addSystemMessage("Could not find the selected turn to fork.");
      return;
    }

    try {
      const sourceName = inheritedForkThreadName(threadId, this.state.threadList.listedThreads);
      const response = await client.forkThread(threadId, this.host.vaultPath);
      const forkedThreadId = response.thread.id;
      if (turnsToDrop > 0) {
        await client.rollbackThread(forkedThreadId, turnsToDrop);
      }
      if (sourceName) {
        try {
          await client.setThreadName(forkedThreadId, sourceName);
          this.host.notifyThreadRenamed(forkedThreadId, sourceName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
        }
      }
      if (archiveSource) {
        if (!(await this.archiveThreadOnServer(threadId))) return;
        try {
          await this.host.openThreadInCurrentPanel(forkedThreadId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.host.addSystemMessage(`Archived thread ${threadId}, but could not open forked thread ${forkedThreadId}: ${message}`);
        }
        this.host.notifyThreadArchived(threadId);
        return;
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
    if (chatTurnBusy(this.state)) {
      this.host.addSystemMessage("Interrupt the current turn before rolling back.");
      return;
    }
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    const candidate = rollbackCandidateFromItems(this.state.transcript.displayItems);
    if (!candidate) {
      this.host.addSystemMessage("No completed turn to roll back.");
      return;
    }

    try {
      this.host.setStatus("Rolling back latest turn...");
      const response = await client.rollbackThread(threadId);
      this.dispatch({
        type: "active-thread/resumed",
        thread: response.thread,
        cwd: response.thread.cwd,
        model: this.state.runtime.activeModel,
        reasoningEffort: this.state.runtime.activeReasoningEffort,
        serviceTier: this.state.runtime.activeServiceTier,
        approvalPolicy: this.state.runtime.activeApprovalPolicy,
        approvalsReviewer: this.state.runtime.activeApprovalsReviewer,
        activePermissionProfile: this.state.runtime.activePermissionProfile,
        listedThreads: upsertThread(this.state.threadList.listedThreads, response.thread),
      });
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
