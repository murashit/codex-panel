import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../../../../domain/threads/archive-markdown";
import { createGoalActions } from "./goal-actions";
import { createSelectionActions } from "./selection-actions";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import type { PluginSettingsRef, ThreadSurfaceBroadcaster, WorkspacePanels } from "../ports/chat-host";
import { AutoTitleController } from "./auto-title-controller";
import { ThreadRenameEditorController } from "./rename-editor-controller";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "./thread-management-actions";
import { createThreadLifecycleParts } from "./lifecycle-parts";

interface ThreadPartsContext {
  obsidian: {
    archiveAdapter: () => ArchiveExportAdapter;
  };
  settingsRef: PluginSettingsRef;
  workspace: Pick<WorkspacePanels, "focusThreadInOpenView" | "openThreadInNewView">;
  threadSurfaces: ThreadSurfaceBroadcaster;
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
    refreshThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  notify: {
    showNotice: (text: string) => void;
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

export function createThreadParts(context: ThreadPartsContext) {
  const {
    obsidian,
    settingsRef,
    workspace,
    threadSurfaces,
    state,
    thread,
    status,
    notify,
    liveState,
    scroll,
    client,
    composer,
    lifecycle,
  } = context;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;

  const rename = new ThreadRenameEditorController({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    settings: () => settingsRef.settings,
    ensureConnected: client.ensureConnected,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
  });
  const autoTitle = new AutoTitleController({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    settings: () => settingsRef.settings,
    currentClient,
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
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
    settingsRef,
    stateStore,
    client: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    lifecycle,
    thread: {
      notifyIdentityChanged: thread.notifyIdentityChanged,
      refreshTabHeader: thread.refreshTabHeader,
    },
    status,
    liveState,
    scroll,
    goals,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  });
  const { history, restoration, resume, identity } = threadLifecycle;
  const threadManagementHost: ThreadManagementActionsHost = {
    stateStore,
    vaultPath: settingsRef.vaultPath,
    settings: () => settingsRef.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    showNotice: notify.showNotice,
    setStatus: status.set,
    setComposerText: composer.setText,
    openThreadInNewView: (threadId) => workspace.openThreadInNewView(threadId),
    openThreadInCurrentPanel: (threadId) => resume.resumeThread(threadId),
    notifyThreadArchived: (threadId) => {
      threadSurfaces.notifyThreadArchived(threadId);
    },
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: () => {
      thread.notifyIdentityChanged();
    },
    refreshThreads: () => thread.refreshThreads(),
    refreshSharedThreadListFromOpenSurface: () => {
      threadSurfaces.refreshSharedThreadListFromOpenSurface();
    },
  };
  const managementActions = createThreadManagementActions(threadManagementHost);

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
  workspace: Pick<WorkspacePanels, "focusThreadInOpenView">;
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
  const { workspace, thread, status } = context;
  const stateStore = context.state.stateStore;

  return createSelectionActions({
    stateStore,
    closeForThreadSelection: refs.closeForThreadSelection,
    focusThreadInOpenView: workspace.focusThreadInOpenView,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
}
