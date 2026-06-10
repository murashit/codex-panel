import type { ConnectionManager } from "../../../app-server/connection-manager";
import { recoverRolloutTokenUsage } from "../../../app-server/rollout-token-usage";
import { createChatThreadActions } from "./thread-actions";
import { createChatThreadGoalActions } from "./thread-goal-actions";
import { ThreadHistoryController } from "./thread-history-controller";
import { createThreadIdentityActions } from "./thread-identity-actions";
import { ThreadRenameController } from "./thread-rename-controller";
import { ThreadResumeController } from "./thread-resume-controller";
import { createThreadSelectionActions } from "./thread-selection-controller";
import { RestoredThreadController } from "./restored-thread-controller";
import type { ToolbarPanelController } from "../panel/toolbar-controller";
import type { ChatControllerCompositionPorts } from "../panel/controller-ports";

type ThreadControllerGroupPorts = Pick<
  ChatControllerCompositionPorts,
  "client" | "composer" | "lifecycle" | "liveState" | "obsidian" | "plugin" | "render" | "scroll" | "state" | "status" | "thread"
>;

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

  const history = new ThreadHistoryController({
    stateStore,
    currentClient,
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    keepCurrentScrollPosition: scroll.preservePosition,
    setThreadTurnPresence: thread.resetTurnPresence,
  });
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
    forceRenderSlots: render.shellSlots,
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
  const threadIdentity = createThreadIdentityActions({
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
    goals,
    restoredThread,
    threadResume,
    threadIdentity,
    threadRename,
  };
}

type ThreadSelectionControllerGroupPorts = Pick<ChatControllerCompositionPorts, "plugin" | "state" | "status" | "thread">;

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
