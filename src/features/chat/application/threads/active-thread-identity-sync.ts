import type { RestorationController } from "./restoration-controller";
import type { ChatStateStore } from "../state/store";
import { activeThreadId } from "./state-selectors";

export interface ActiveThreadIdentitySyncHost {
  stateStore: ChatStateStore;
  restoration: RestorationController;
  invalidateThreadWork: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
}

export interface ActiveThreadIdentitySync {
  clearActiveThreadIdentity: () => void;
  applyThreadArchiveToActiveIdentity: (threadId: string) => void;
  applyThreadRenameToActiveIdentity: (threadId: string, name: string | null) => void;
}

export function createActiveThreadIdentitySync(host: ActiveThreadIdentitySyncHost): ActiveThreadIdentitySync {
  return {
    clearActiveThreadIdentity: () => {
      clearActiveThreadIdentity(host);
    },
    applyThreadArchiveToActiveIdentity: (threadId) => {
      applyThreadArchiveToActiveIdentity(host, threadId);
    },
    applyThreadRenameToActiveIdentity: (threadId, name) => {
      applyThreadRenameToActiveIdentity(host, threadId, name);
    },
  };
}

function clearActiveThreadIdentity(host: ActiveThreadIdentitySyncHost): void {
  host.invalidateThreadWork();
  host.restoration.clear();
  host.stateStore.dispatch({ type: "active-thread/cleared" });
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
}

function applyThreadArchiveToActiveIdentity(host: ActiveThreadIdentitySyncHost, threadId: string): void {
  if (activeThreadId(host.stateStore.getState()) !== threadId && !host.restoration.isPending(threadId)) return;
  clearActiveThreadIdentity(host);
}

function applyThreadRenameToActiveIdentity(host: ActiveThreadIdentitySyncHost, threadId: string, name: string | null): void {
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
