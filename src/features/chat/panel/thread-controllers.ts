import type { ConnectionManager } from "../../../app-server/connection-manager";
import { recoverRolloutTokenUsage } from "../../../app-server/rollout-token-usage";
import { ChatRuntimeSettingsController } from "../controllers/runtime/runtime-settings-controller";
import { ChatThreadActionController } from "../controllers/thread/thread-actions-controller";
import { ChatThreadGoalController } from "../controllers/thread/thread-goal-controller";
import { ThreadHistoryController } from "../controllers/thread/thread-history-controller";
import { ThreadIdentityController } from "../controllers/thread/thread-identity-controller";
import { ThreadRenameController } from "../controllers/thread/thread-rename-controller";
import { ThreadResumeController } from "../controllers/thread/thread-resume-controller";
import { createThreadSelectionActions } from "../controllers/thread/thread-selection-controller";
import { RestoredThreadController } from "../controllers/thread/restored-thread-controller";
import { ChatReconnectController } from "../controllers/connection/reconnect-controller";
import { createChatViewStateActions } from "../controllers/view/view-state-controller";
import { ToolbarPanelController } from "./toolbar-controller";
import type { ChatPanelContext } from "./context";

export function createThreadControllerGroup(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { obsidian, plugin, state, runtime, thread, status, liveState, scroll, render, client, composer, lifecycle } = context;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;
  const { deferredTasks, resumeWork } = lifecycle;

  const history = new ThreadHistoryController({
    stateStore,
    currentClient,
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    forceMessagesToBottom: scroll.forceBottom,
    keepCurrentScrollPosition: scroll.preservePosition,
    setThreadTurnPresence: thread.resetTurnPresence,
  });
  const threadActions = new ChatThreadActionController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient,
    history,
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
  });
  const toolbarPanels = new ToolbarPanelController({
    stateStore,
    threadActions,
    scheduleRender: render.schedule,
  });
  const threadSelection = createThreadSelectionActions({
    stateStore,
    closeForThreadSelection: () => {
      toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
  const reconnectActions = new ChatReconnectController({
    stateStore,
    invalidateConnectionWork: lifecycle.invalidateConnectionWork,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredDiagnostics: lifecycle.clearDeferredDiagnostics,
    reconnect: () => {
      refs.connection.reconnect();
    },
    clearClient: client.clear,
    setStatus: status.set,
    render: render.now,
    ensureConnected: client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
  const runtimeSettings = new ChatRuntimeSettingsController({
    stateStore,
    currentClient,
    runtimeSnapshot: runtime.runtimeSnapshot,
    collaborationModeLabel: runtime.collaborationModeLabel,
    addSystemMessage: status.addSystemMessage,
  });
  const goals = new ChatThreadGoalController({
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
  const restoredThread = new RestoredThreadController({
    deferredTasks,
    opened: lifecycle.getOpened,
    resumeThread: thread.resumeThread,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    stateStore,
    systemItem: state.systemItem,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const viewStateController = createChatViewStateActions({
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: thread.restorePlaceholder,
  });
  const threadResume = new ThreadResumeController({
    stateStore,
    vaultPath: plugin.vaultPath,
    resumeWork,
    history,
    restoredThread,
    currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    systemItem: state.systemItem,
    resetThreadTurnPresence: thread.resetTurnPresence,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    forceMessagesToBottom: scroll.forceBottom,
    render: render.now,
    refreshLiveState: liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, async (filePath, options) => {
        const response = await currentClient()?.readFile(filePath, options);
        return response?.dataBase64 ?? "";
      }),
  });
  const threadIdentity = new ThreadIdentityController({
    stateStore,
    restoredThread,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    resetThreadTurnPresence: thread.resetTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
    refreshLiveState: liveState.refresh,
    render: render.now,
  });
  const threadRename = new ThreadRenameController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    refreshThreads: thread.refreshThreads,
    render: render.shellSlots,
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });

  return {
    history,
    threadActions,
    toolbarPanels,
    threadSelection,
    reconnectActions,
    runtimeSettings,
    goals,
    restoredThread,
    viewStateController,
    threadResume,
    threadIdentity,
    threadRename,
  };
}
