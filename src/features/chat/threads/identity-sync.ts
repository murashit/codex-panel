import type { RestorationController } from "./restoration-controller";
import { activeThreadId, listedThreads } from "../state/selectors";
import type { ChatStateStore } from "../state/reducer";

export interface IdentitySyncHost {
  stateStore: ChatStateStore;
  restoration: RestorationController;
  invalidateResumeWork: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  render: () => void;
}

export interface IdentitySync {
  clearActiveThreadContext: () => void;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string | null) => void;
}

export function createIdentitySync(host: IdentitySyncHost): IdentitySync {
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

function clearActiveThreadContext(host: IdentitySyncHost): void {
  host.invalidateResumeWork();
  host.restoration.clear();
  host.clearDeferredRestoredThreadHydration();
  host.stateStore.dispatch({ type: "active-thread/cleared" });
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  host.refreshLiveState();
}

function notifyThreadArchived(host: IdentitySyncHost, threadId: string): void {
  if (activeThreadId(host.stateStore.getState()) !== threadId) return;
  clearActiveThreadContext(host);
  host.render();
}

function notifyThreadRenamed(host: IdentitySyncHost, threadId: string, name: string | null): void {
  let changed = false;
  const renamedThreads = listedThreads(host.stateStore.getState()).map((thread) => {
    if (thread.id !== threadId) return thread;
    changed = true;
    return { ...thread, name };
  });
  host.stateStore.dispatch({ type: "thread-list/applied", threads: renamedThreads });
  const restoredThread = host.restoration.placeholder();
  if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
    host.restoration.rename(threadId, name);
    changed = true;
  }
  const activeThreadChanged = activeThreadId(host.stateStore.getState()) === threadId || host.restoration.isPending(threadId);
  if (!changed && !activeThreadChanged) return;
  if (activeThreadChanged) {
    host.notifyActiveThreadIdentityChanged();
  } else {
    host.refreshTabHeader();
  }
  host.render();
}
