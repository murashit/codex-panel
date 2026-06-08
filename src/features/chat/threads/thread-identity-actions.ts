import type { RestoredThreadController } from "./restored-thread-controller";
import { applyThreadListAction, clearActiveThreadAction } from "../chat-state-actions";
import { activeThreadId, listedThreads } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";

export interface ThreadIdentityActionsHost {
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

export interface ThreadIdentityActions {
  clearActiveThreadContext: () => void;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string | null) => void;
}

export function createThreadIdentityActions(host: ThreadIdentityActionsHost): ThreadIdentityActions {
  return {
    clearActiveThreadContext: () => {
      clearActiveThreadContext(host);
    },
    notifyThreadArchived: (threadId) => {
      notifyThreadArchived(host, threadId);
    },
    notifyThreadRenamed: (threadId, name) => {
      notifyThreadRenamed(host, threadId, name);
    },
  };
}

function clearActiveThreadContext(host: ThreadIdentityActionsHost): void {
  host.invalidateResumeWork();
  host.restoredThread.clear();
  host.clearDeferredRestoredThreadHydration();
  host.stateStore.dispatch(clearActiveThreadAction());
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  host.refreshLiveState();
}

function notifyThreadArchived(host: ThreadIdentityActionsHost, threadId: string): void {
  if (activeThreadId(host.stateStore.getState()) !== threadId) return;
  clearActiveThreadContext(host);
  host.render();
}

function notifyThreadRenamed(host: ThreadIdentityActionsHost, threadId: string, name: string | null): void {
  let changed = false;
  const renamedThreads = listedThreads(host.stateStore.getState()).map((thread) => {
    if (thread.id !== threadId) return thread;
    changed = true;
    return { ...thread, name };
  });
  host.stateStore.dispatch(applyThreadListAction(renamedThreads));
  const restoredThread = host.restoredThread.placeholder();
  if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
    host.restoredThread.rename(threadId, name);
    changed = true;
  }
  const activeThreadChanged = activeThreadId(host.stateStore.getState()) === threadId || host.restoredThread.isPending(threadId);
  if (!changed && !activeThreadChanged) return;
  if (activeThreadChanged) {
    host.notifyActiveThreadIdentityChanged();
  } else {
    host.refreshTabHeader();
  }
  host.render();
}
