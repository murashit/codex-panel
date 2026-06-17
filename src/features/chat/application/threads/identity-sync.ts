import type { RestorationController } from "./restoration-controller";
import { activeThreadId } from "../state/selectors";
import type { ChatStateStore } from "../state/store";

export interface IdentitySyncHost {
  stateStore: ChatStateStore;
  restoration: RestorationController;
  invalidateThreadWork: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
}

export interface IdentitySync {
  clearActiveThreadContext: () => void;
  applyThreadArchived: (threadId: string) => void;
  applyThreadRenamed: (threadId: string, name: string | null) => void;
}

export function createIdentitySync(host: IdentitySyncHost): IdentitySync {
  return {
    clearActiveThreadContext: () => {
      clearActiveThreadContext(host);
    },
    applyThreadArchived: (threadId) => {
      applyThreadArchived(host, threadId);
    },
    applyThreadRenamed: (threadId, name) => {
      applyThreadRenamed(host, threadId, name);
    },
  };
}

function clearActiveThreadContext(host: IdentitySyncHost): void {
  host.invalidateThreadWork();
  host.restoration.clear();
  host.clearDeferredRestoredThreadHydration();
  host.stateStore.dispatch({ type: "active-thread/cleared" });
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  host.refreshLiveState();
}

function applyThreadArchived(host: IdentitySyncHost, threadId: string): void {
  if (activeThreadId(host.stateStore.getState()) !== threadId) return;
  clearActiveThreadContext(host);
}

function applyThreadRenamed(host: IdentitySyncHost, threadId: string, name: string | null): void {
  let changed = false;
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
}
