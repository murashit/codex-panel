import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../../thread-export/archive-markdown";
import { createGoalActions } from "./goal-actions";
import { createSelectionActions } from "./selection-actions";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatStateStore } from "../state/reducer";
import type { CodexChatHost } from "../chat-host";
import { createThreadNamingParts } from "./naming-parts";
import { createThreadManagementActions } from "./thread-management-actions";
import { createThreadLifecycleParts } from "./lifecycle-parts";

interface ThreadPartsContext {
  obsidian: {
    archiveAdapter: () => ArchiveExportAdapter;
  };
  plugin: CodexChatHost;
  state: {
    stateStore: ChatStateStore;
  };
  client: {
    getClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    resumeWork: ChatResumeWorkTracker;
    getOpened: () => boolean;
    getClosing: () => boolean;
  };
  thread: {
    selectThread: (threadId: string) => Promise<void>;
    resumeRestoredThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  liveState: {
    refresh: () => void;
  };
  scroll: {
    preservePosition: () => void;
    forceBottom: () => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createThreadParts(
  context: ThreadPartsContext,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { obsidian, plugin, state, thread, status, liveState, scroll, client, composer, lifecycle } = context;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;

  const naming = createThreadNamingParts(
    {
      plugin,
      stateStore,
      client: {
        currentClient,
        ensureConnected: client.ensureConnected,
      },
      status: {
        addSystemMessage: status.addSystemMessage,
      },
    },
    {
      connection: refs.connection,
    },
  );
  const { rename, autoTitle, resetThreadTurnPresence } = naming;

  const managementActions = createThreadManagementActions({
    obsidian,
    plugin,
    stateStore,
    client: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    status,
    thread: {
      selectThread: thread.selectThread,
      refreshThreads: thread.refreshThreads,
      notifyIdentityChanged: thread.notifyIdentityChanged,
    },
    composer,
  });
  const goals = createGoalActions({
    stateStore,
    currentClient,
    ensureConnected: client.ensureConnected,
    addSystemMessage: status.addSystemMessage,
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState: liveState.refresh,
  });
  const threadLifecycle = createThreadLifecycleParts({
    plugin,
    stateStore,
    client: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    lifecycle,
    thread: {
      resumeRestoredThread: thread.resumeRestoredThread,
      notifyIdentityChanged: thread.notifyIdentityChanged,
      refreshTabHeader: thread.refreshTabHeader,
    },
    status,
    liveState,
    scroll,
    goals,
    resetThreadTurnPresence,
  });
  const { history, restoration, resume, identity } = threadLifecycle;

  return {
    history,
    managementActions,
    goals,
    restoration,
    resume,
    identity,
    rename,
    autoTitle,
  };
}

interface ThreadSelectionActionsContext {
  plugin: CodexChatHost;
  state: {
    stateStore: ChatStateStore;
  };
  status: {
    addSystemMessage: (text: string) => void;
  };
  thread: {
    resumeThread: (threadId: string) => Promise<void>;
  };
}

export function createThreadSelectionActions(
  context: ThreadSelectionActionsContext,
  refs: {
    closeForThreadSelection: () => void;
  },
) {
  const { plugin, thread, status } = context;
  const stateStore = context.state.stateStore;

  return createSelectionActions({
    stateStore,
    closeForThreadSelection: () => {
      refs.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
}
