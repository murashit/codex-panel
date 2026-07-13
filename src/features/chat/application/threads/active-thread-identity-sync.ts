import type { ChatStateStore } from "../state/store";

export interface ActiveThreadIdentitySyncHost {
  stateStore: ChatStateStore;
  invalidateThreadWork: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
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
  host.stateStore.dispatch({ type: "active-thread/cleared" });
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
}

function applyThreadArchiveToActiveIdentity(host: ActiveThreadIdentitySyncHost, threadId: string): void {
  const state = host.stateStore.getState();
  if (state.activeThread.id !== threadId && !(state.restoration.kind === "thread" && state.restoration.threadId === threadId)) return;
  clearActiveThreadIdentity(host);
}

function applyThreadRenameToActiveIdentity(host: ActiveThreadIdentitySyncHost, threadId: string, name: string | null): void {
  const state = host.stateStore.getState();
  const restoredThreadChanged = state.restoration.kind === "thread" && state.restoration.threadId === threadId;
  const activeThreadChanged = state.activeThread.id === threadId;
  if (!restoredThreadChanged && !activeThreadChanged) return;
  if (restoredThreadChanged) host.stateStore.dispatch({ type: "panel/restored-thread-renamed", threadId, name });
  host.notifyActiveThreadIdentityChanged();
}
