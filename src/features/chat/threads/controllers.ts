import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { recoverRolloutTokenUsage } from "../../../app-server/services/rollout-token-usage";
import { archiveThread } from "./archive-actions";
import { AutoTitleController } from "./auto-title-controller";
import { compactThread } from "./compact-actions";
import { forkThread, forkThreadFromTurn } from "./fork-actions";
import { createGoalActions } from "./goal-actions";
import { HistoryController } from "./history-controller";
import { createIdentitySync } from "./identity-sync";
import { RenameController } from "./rename-controller";
import { renameThread } from "./rename-actions";
import { ResumeController } from "./resume-controller";
import { rollbackThread } from "./rollback-actions";
import { createSelectionActions } from "./selection-actions";
import { RestorationController } from "./restoration-controller";
import type { ChatThreadActions, ChatThreadActionsHost } from "./action-context";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatControllerPorts } from "../controller-ports";

type ThreadControllerGroupPorts = Pick<ChatControllerPorts, "obsidian" | "plugin" | "state" | "lifecycle" | "thread" | "liveState"> & {
  client: {
    getClient: ChatControllerPorts["client"]["getClient"];
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
    refreshThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  scroll: Pick<ChatControllerPorts["scroll"], "preservePosition" | "forceBottom">;
  render: {
    now: () => void;
  };
  composer: {
    setText: (text: string) => void;
  };
};

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

  const rename = new RenameController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });
  const autoTitle = new AutoTitleController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    currentClient,
    render: render.now,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });
  const resetThreadTurnPresence = (hadTurns: boolean) => {
    autoTitle.resetThreadTurnPresence(hadTurns);
  };
  const history = new HistoryController({
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
  const threadActionHost: ChatThreadActionsHost = {
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
  };
  const actions: ChatThreadActions = {
    compactThread: (threadId) => compactThread(threadActionHost, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(threadActionHost, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(threadActionHost, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(threadActionHost, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(threadActionHost, threadId, name),
    rollbackThread: (threadId) => rollbackThread(threadActionHost, threadId),
  };
  const goals = createGoalActions({
    stateStore,
    currentClient,
    ensureConnected: client.ensureConnected,
    addSystemMessage: status.addSystemMessage,
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    render: render.now,
    refreshLiveState: liveState.refresh,
  });
  let resume: ResumeController | null = null;
  const restoration = new RestorationController({
    deferredTasks,
    opened: lifecycle.getOpened,
    resumeThread: (threadId) => requireThreadController(resume, "resume controller").resumeThread(threadId),
    invalidateResumeWork,
    stateStore,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  resume = new ResumeController({
    stateStore,
    vaultPath: plugin.vaultPath,
    resumeWork,
    history,
    restoration,
    currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    resetThreadTurnPresence,
    clearDeferredRestoredThreadHydration: () => {
      restoration.clearHydration();
    },
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
  const identity = createIdentitySync({
    stateStore,
    restoration,
    invalidateResumeWork,
    clearDeferredRestoredThreadHydration: () => {
      restoration.clearHydration();
    },
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
    refreshLiveState: liveState.refresh,
    render: render.now,
  });

  return {
    history,
    actions,
    goals,
    restoration,
    resume: requireThreadController(resume, "resume controller"),
    identity,
    rename,
    autoTitle,
    invalidateResumeWork,
  };
}

function requireThreadController<T>(controller: T | null, name: string): T {
  if (!controller) throw new Error(`Chat thread controller graph did not initialize ${name}.`);
  return controller;
}

type ThreadSelectionActionGroupPorts = Pick<ChatControllerPorts, "plugin" | "state"> & {
  status: {
    addSystemMessage: (text: string) => void;
  };
  thread: {
    resumeThread: (threadId: string) => Promise<void>;
  };
};

export function createThreadSelectionActionGroup(
  context: ThreadSelectionActionGroupPorts,
  refs: {
    closeForThreadSelection: () => void;
  },
) {
  const { plugin, thread, status } = context;
  const stateStore = context.state.stateStore;

  const selection = createSelectionActions({
    stateStore,
    closeForThreadSelection: () => {
      refs.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });

  return { selection };
}
