import type { AppServerClient } from "../../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../../thread-export/archive-markdown";
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
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  openThreadInCurrentPanel: (threadId: string) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshThreads: () => Promise<void>;
  refreshSharedThreadListFromOpenSurface: () => void;
}

export interface ChatThreadActions {
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
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
