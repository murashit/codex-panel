import type { RestoredThreadController } from "./restored-thread-controller";
import type { ThreadLifecycleStatePort } from "../state-ports";

export interface ThreadIdentityControllerHost {
  state: ThreadLifecycleStatePort;
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
    this.host.state.clearActiveThread();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.refreshLiveState();
  }

  notifyThreadArchived(threadId: string): void {
    if (this.host.state.activeThreadId() !== threadId) return;
    this.clearActiveThreadContext();
    this.host.render();
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    let changed = false;
    const listedThreads = this.host.state.listedThreads.map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return { ...thread, name };
    });
    this.host.state.applyThreadList(listedThreads);
    const restoredThread = this.host.restoredThread.placeholder();
    if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
      this.host.restoredThread.rename(threadId, name);
      changed = true;
    }
    const activeThreadChanged = this.host.state.activeThreadId() === threadId || this.host.restoredThread.isPending(threadId);
    if (!changed && !activeThreadChanged) return;
    if (activeThreadChanged) {
      this.host.notifyActiveThreadIdentityChanged();
    } else {
      this.host.refreshTabHeader();
    }
    this.host.render();
  }
}
