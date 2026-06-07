import type { RestoredThreadController } from "./restored-thread-controller";
import { applyThreadListAction, clearActiveThreadAction } from "../../chat-state-actions";
import { activeThreadId, listedThreads } from "../../chat-state-selectors";
import type { ChatStateStore } from "../../chat-state";

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
    this.host.stateStore.dispatch(clearActiveThreadAction());
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.refreshLiveState();
  }

  notifyThreadArchived(threadId: string): void {
    if (activeThreadId(this.host.stateStore.getState()) !== threadId) return;
    this.clearActiveThreadContext();
    this.host.render();
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    let changed = false;
    const renamedThreads = listedThreads(this.host.stateStore.getState()).map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return { ...thread, name };
    });
    this.host.stateStore.dispatch(applyThreadListAction(renamedThreads));
    const restoredThread = this.host.restoredThread.placeholder();
    if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
      this.host.restoredThread.rename(threadId, name);
      changed = true;
    }
    const activeThreadChanged =
      activeThreadId(this.host.stateStore.getState()) === threadId || this.host.restoredThread.isPending(threadId);
    if (!changed && !activeThreadChanged) return;
    if (activeThreadChanged) {
      this.host.notifyActiveThreadIdentityChanged();
    } else {
      this.host.refreshTabHeader();
    }
    this.host.render();
  }
}
