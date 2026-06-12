import type { ConnectionManager } from "../../../app-server/connection-manager";
import type { AppServerClient } from "../../../app-server/client";
import { recoverRolloutTokenUsage } from "../../../app-server/rollout-token-usage";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import { createChatThreadActions } from "./thread-actions";
import { createChatThreadGoalActions } from "./thread-goal-actions";
import { ThreadHistoryController } from "./thread-history-controller";
import { createThreadIdentityActions } from "./thread-identity-actions";
import { ThreadRenameController } from "./thread-rename-controller";
import { ThreadResumeController } from "./thread-resume-controller";
import { createThreadSelectionActions } from "./thread-selection-controller";
import { RestoredThreadController } from "./restored-thread-controller";
import type { ToolbarPanelController } from "../panel/regions/toolbar";
import type { ChatStateStore } from "../state/reducer";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { CodexPanelSettings } from "../../../settings/model";

interface ThreadControllerGroupPorts {
  obsidian: {
    archiveAdapter: () => ArchiveExportAdapter;
  };
  plugin: {
    notifyThreadArchived: (threadId: string) => void;
    notifyThreadRenamed: (threadId: string, name: string | null) => void;
    openThreadInNewView: (threadId: string) => Promise<unknown>;
    refreshSharedThreadListFromOpenSurface: () => void;
    settings: CodexPanelSettings;
    vaultPath: string;
  };
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
    clearDeferredRestoredThreadHydration: () => void;
  };
  thread: {
    selectThread: (threadId: string) => Promise<void>;
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
  render: {
    now: () => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createThreadControllerGroup(
  context: ThreadControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { obsidian, plugin, state, thread, status, liveState, scroll, render, client, composer, lifecycle } = context;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;
  const { deferredTasks, resumeWork } = lifecycle;

  const threadRename = new ThreadRenameController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });
  const resetThreadTurnPresence = (hadTurns: boolean) => {
    threadRename.resetThreadTurnPresence(hadTurns);
  };
  const history = new ThreadHistoryController({
    stateStore,
    currentClient,
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    keepCurrentScrollPosition: scroll.preservePosition,
    showLatestPageAtBottom: scroll.forceBottom,
    setThreadTurnPresence: resetThreadTurnPresence,
  });
  const invalidateResumeWork = () => {
    resumeWork.invalidate();
    history.invalidate();
  };
  const threadActions = createChatThreadActions({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: composer.setText,
    render: render.now,
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
  });
  const goals = createChatThreadGoalActions({
    stateStore,
    currentClient,
    ensureConnected: client.ensureConnected,
    addSystemMessage: status.addSystemMessage,
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "transcript/item-upserted", item });
    },
    render: render.now,
    refreshLiveState: liveState.refresh,
  });
  let threadResume: ThreadResumeController | null = null;
  const restoredThread = new RestoredThreadController({
    deferredTasks,
    opened: lifecycle.getOpened,
    resumeThread: (threadId) => requireThreadController(threadResume, "thread resume controller").resumeThread(threadId),
    invalidateResumeWork,
    stateStore,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  threadResume = new ThreadResumeController({
    stateStore,
    vaultPath: plugin.vaultPath,
    resumeWork,
    history,
    restoredThread,
    currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    resetThreadTurnPresence,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    render: render.now,
    refreshLiveState: liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, async (filePath, options) => {
        const response = await currentClient()?.readFile(filePath, options);
        return response?.dataBase64 ?? "";
      }),
  });
  const threadIdentity = createThreadIdentityActions({
    stateStore,
    restoredThread,
    invalidateResumeWork,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
    refreshLiveState: liveState.refresh,
    render: render.now,
  });

  return {
    history,
    threadActions,
    goals,
    restoredThread,
    threadResume: requireThreadController(threadResume, "thread resume controller"),
    threadIdentity,
    threadRename,
    invalidateResumeWork,
  };
}

function requireThreadController<T>(controller: T | null, name: string): T {
  if (!controller) throw new Error(`Chat thread controller composition did not initialize ${name}.`);
  return controller;
}

interface ThreadSelectionControllerGroupPorts {
  plugin: {
    focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  };
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

export function createThreadSelectionControllerGroup(
  context: ThreadSelectionControllerGroupPorts,
  refs: {
    toolbarPanels: ToolbarPanelController;
  },
) {
  const { plugin, thread, status } = context;
  const stateStore = context.state.stateStore;

  const threadSelection = createThreadSelectionActions({
    stateStore,
    closeForThreadSelection: () => {
      refs.toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });

  return { threadSelection };
}
