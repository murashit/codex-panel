import type { AppServerClient } from "../../../../app-server/client";
import type { ThreadTokenUsage } from "../../../../generated/app-server/v2/ThreadTokenUsage";
import type { DisplayItem } from "../../display/types";
import type { RestoredThreadController } from "./restored-thread-controller";
import type { ThreadActivationResponse } from "../../thread-resume";
import type { ThreadHistoryController } from "./thread-history-controller";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../../panel/lifecycle";
import type { ThreadLifecycleStatePort } from "../state-ports";

export interface ThreadResumeControllerHost {
  state: ThreadLifecycleStatePort;
  vaultPath: string;
  resumeWork: ChatResumeWorkTracker;
  history: ThreadHistoryController;
  restoredThread: RestoredThreadController;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  closing: () => boolean;
  systemItem: (text: string) => DisplayItem;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  clearDeferredRestoredThreadHydration: () => void;
  notifyActiveThreadIdentityChanged: () => void;
  addSystemMessage: (text: string) => void;
  forceMessagesToBottom: () => void;
  render: () => void;
  refreshLiveState: () => void;
  syncThreadGoal: (threadId: string) => Promise<void>;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export class ThreadResumeController {
  constructor(private readonly host: ThreadResumeControllerHost) {}

  async resumeThread(threadId: string): Promise<void> {
    if (!this.host.state.canSwitchToThread(threadId)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    const resume = this.host.resumeWork.begin(threadId);
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client || this.isStale(resume)) return;

    try {
      const response = await client.resumeThread(threadId, this.host.vaultPath);
      if (this.isStale(resume)) return;
      this.applyResumedThread(response);
      this.recoverResumedThreadTokenUsage(response.thread.id, response.thread.path, resume);
      if (response.initialTurnsPage) {
        this.host.history.applyLatestPage(response.thread.id, response.initialTurnsPage);
      } else {
        await this.host.history.loadLatest(response.thread.id);
      }
      if (this.isStale(resume)) return;
      await this.host.syncThreadGoal(response.thread.id);
      if (this.isStale(resume)) return;
      if (this.host.state.displayItemsEmpty()) {
        this.host.addSystemMessage(`Resumed thread ${response.thread.id}`);
        this.host.forceMessagesToBottom();
        this.host.render();
      }
      this.host.refreshLiveState();
    } catch (error) {
      if (this.isStale(resume)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private applyResumedThread(response: ThreadActivationResponse): void {
    this.host.state.applyResumedThread(response, [this.host.systemItem("Loading thread...")]);
    this.host.restoredThread.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.forceMessagesToBottom();
    this.host.render();
    this.host.refreshLiveState();
  }

  private recoverResumedThreadTokenUsage(threadId: string, path: string | null, resume: ActiveChatResume): void {
    if (!path || !this.host.recoverTokenUsageFromRollout) return;
    void this.host
      .recoverTokenUsageFromRollout(path)
      .then((tokenUsage) => {
        if (!tokenUsage || this.isStale(resume)) return;
        if (!this.host.state.applyRecoveredTokenUsage(threadId, tokenUsage)) return;
        this.host.refreshLiveState();
        this.host.render();
      })
      .catch(() => undefined);
  }

  private isStale(resume: ActiveChatResume): boolean {
    return this.host.resumeWork.isStale(resume) || this.host.closing();
  }
}
