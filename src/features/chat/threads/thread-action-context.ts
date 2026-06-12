import type { AppServerClient } from "../../../app-server/client";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ChatAction, ChatState, ChatStateStore } from "../state/reducer";

export interface ChatThreadActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  archiveAdapter: () => ArchiveExportAdapter;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setComposerText: (text: string) => void;
  render: () => void;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export function threadActionState(host: ChatThreadActionsHost): ChatState {
  return host.stateStore.getState();
}

export function threadActionDispatch(host: ChatThreadActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

export function threadActionStillTargetsPanel(state: ChatState, threadId: string): boolean {
  return state.activeThread.id === threadId;
}

export function threadActionStillTargetsOriginalPanel(state: ChatState, initialThreadId: string | null, threadId: string): boolean {
  if (!initialThreadId) return true;
  return initialThreadId === threadId && state.activeThread.id === threadId;
}
