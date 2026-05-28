import type { ChatStateStore } from "../../chat-state";
import type { RestoredThreadController } from "./restored-thread-controller";

export interface ThreadIdentityControllerHost {
  stateStore: ChatStateStore;
  restoredThread: RestoredThreadController;
  invalidateResumeWork: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  render: () => void;
}

export class ThreadIdentityController {
  constructor(private readonly host: ThreadIdentityControllerHost) {}

  clearActiveThreadContext(): void {
    this.host.invalidateResumeWork();
    this.host.restoredThread.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.stateStore.dispatch({ type: "thread/active-cleared" });
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.refreshLiveState();
  }

  notifyThreadArchived(threadId: string): void {
    if (this.state.activeThreadId !== threadId) return;
    this.clearActiveThreadContext();
    this.host.render();
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    let changed = false;
    const listedThreads = this.state.listedThreads.map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return { ...thread, name };
    });
    this.host.stateStore.dispatch({ type: "thread/list-applied", threads: listedThreads });
    const restoredThread = this.host.restoredThread.placeholder();
    if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
      this.host.restoredThread.rename(threadId, name);
      changed = true;
    }
    const activeThreadChanged = this.state.activeThreadId === threadId || this.host.restoredThread.isPending(threadId);
    if (!changed && !activeThreadChanged) return;
    if (activeThreadChanged) {
      this.host.notifyActiveThreadIdentityChanged();
    } else {
      this.host.refreshTabHeader();
    }
    this.host.render();
  }

  private get state() {
    return this.host.stateStore.getState();
  }
}
