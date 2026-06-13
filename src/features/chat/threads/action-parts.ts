import type { AppServerClient } from "../../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../../thread-export/archive-markdown";
import type { ChatStateStore } from "../state/reducer";
import type { CodexChatHost } from "../chat-host";
import { archiveThread } from "./archive-actions";
import { compactThread } from "./compact-actions";
import { forkThread, forkThreadFromTurn } from "./fork-actions";
import { renameThread } from "./rename-actions";
import { rollbackThread } from "./rollback-actions";
import type { ChatThreadActions, ChatThreadActionsHost } from "./action-context";

export interface ThreadActionPartsContext {
  obsidian: {
    archiveAdapter: () => ArchiveExportAdapter;
  };
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  thread: {
    selectThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createThreadActions(context: ThreadActionPartsContext): ChatThreadActions {
  const { obsidian, plugin, stateStore, client, status, thread, composer } = context;
  const host: ChatThreadActionsHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient: client.currentClient,
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: composer.setText,
    openThreadInNewView: (threadId) => plugin.openThreadInNewView(threadId),
    openThreadInCurrentPanel: thread.selectThread,
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: (threadId, name) => {
      plugin.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshThreads: thread.refreshThreads,
    refreshSharedThreadListFromOpenSurface: () => {
      plugin.refreshSharedThreadListFromOpenSurface();
    },
  };

  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
  };
}
