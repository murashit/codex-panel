import { Notice } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { exportArchivedThreadMarkdown } from "../../domain/threads/export";
import { inheritedForkThreadName, upsertThread } from "../../domain/threads/model";
import type { CodexPanelSettings } from "../../settings/model";
import type { ArchiveExportAdapter } from "../../domain/threads/export";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "./chat-state";
import type { ThreadHistoryLoader } from "./thread-history";
import { turnsAfterTurnId } from "./fork";
import { rollbackCandidateFromItems } from "./rollback";

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
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
  closePanel: () => void;
}

export class ChatThreadActionController {
  constructor(private readonly host: ChatThreadActionControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  async archiveThread(threadId: string, saveMarkdown = this.host.settings().archiveExportEnabled): Promise<void> {
    await this.archiveThreadWithResult(threadId, saveMarkdown);
  }

  private async archiveThreadWithResult(threadId: string, saveMarkdown = this.host.settings().archiveExportEnabled): Promise<boolean> {
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
      this.host.notifyThreadArchived(threadId);
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

    const turnsToDrop = turnId ? turnsAfterTurnId(this.state.displayItems, turnId) : 0;
    if (turnsToDrop === null) {
      this.host.addSystemMessage("Could not find the selected turn to fork.");
      return;
    }

    try {
      const sourceName = inheritedForkThreadName(threadId, this.state.listedThreads);
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
      let openedForkPanel = false;
      try {
        await this.host.openThreadInNewView(forkedThreadId);
        openedForkPanel = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
      }
      if (archiveSource) {
        if (!openedForkPanel) return;
        const archived = await this.archiveThreadWithResult(threadId);
        if (archived) this.host.closePanel();
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

    const candidate = rollbackCandidateFromItems(this.state.displayItems);
    if (!candidate) {
      this.host.addSystemMessage("No completed turn to roll back.");
      return;
    }

    try {
      this.host.setStatus("Rolling back latest turn...");
      const response = await client.rollbackThread(threadId);
      this.dispatch({
        type: "thread/resumed",
        thread: response.thread,
        cwd: response.thread.cwd,
        model: this.state.activeModel,
        reasoningEffort: this.state.activeReasoningEffort,
        serviceTier: this.state.activeServiceTier,
        approvalPolicy: this.state.activeApprovalPolicy,
        approvalsReviewer: this.state.activeApprovalsReviewer,
        activePermissionProfile: this.state.activePermissionProfile,
        listedThreads: upsertThread(this.state.listedThreads, response.thread),
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
