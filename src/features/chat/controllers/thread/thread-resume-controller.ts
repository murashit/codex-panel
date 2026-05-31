import type { AppServerClient } from "../../../../app-server/client";
import type { ChatStateStore } from "../../chat-state";
import { chatTurnBusy } from "../../chat-state";
import type { DisplayItem } from "../../display/types";
import type { RestoredThreadController } from "./restored-thread-controller";
import { resumedThreadAction, type ThreadActivationResponse } from "../../thread-resume";
import type { ThreadHistoryLoader } from "../../thread-history";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../../view-lifecycle";

export interface ThreadResumeControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  resumeWork: ChatResumeWorkTracker;
  history: ThreadHistoryLoader;
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
}

export class ThreadResumeController {
  constructor(private readonly host: ThreadResumeControllerHost) {}

  async resumeThread(threadId: string): Promise<void> {
    const state = this.host.stateStore.getState();
    if (chatTurnBusy(state) && threadId !== state.activeThreadId) {
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
      await this.host.history.loadLatest(response.thread.id);
      if (this.isStale(resume)) return;
      if (this.host.stateStore.getState().displayItems.length === 0) {
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
    this.host.stateStore.dispatch(
      resumedThreadAction({
        response,
        listedThreads: this.host.stateStore.getState().listedThreads,
        displayItems: [this.host.systemItem("Loading thread...")],
      }),
    );
    this.host.restoredThread.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.forceMessagesToBottom();
    this.host.render();
    this.host.refreshLiveState();
  }

  private isStale(resume: ActiveChatResume): boolean {
    return this.host.resumeWork.isStale(resume) || this.host.closing();
  }
}
