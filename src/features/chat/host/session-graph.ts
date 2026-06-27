import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import { createLocalIdSource, type LocalIdSource } from "../../../shared/id/local-id";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import type { ChatAction, ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeActions } from "../application/threads/resume-actions";
import type { ChatResumeWorkTracker } from "../application/threads/resume-work";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import type { ChatComposerController } from "../panel/composer-controller";
import type { ChatMessageScrollController } from "../panel/surface/message-stream-scroll";
import { createComposerBundle } from "./composer-bundle";
import { type ChatPanelConnectionBundle, createConnectionBundle } from "./connection-bundle";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatViewDeferredTasks } from "./deferred-work";
import { createRuntimeBundle } from "./runtime-bundle";
import { type ChatPanelSharedStateBinding, createChatPanelSharedStateBinding } from "./shared-state-binding";
import { type ChatPanelShellBundle, createShellBundle } from "./shell-bundle";
import { createThreadActionBundle, createThreadFoundation, createThreadLifecycleBundle } from "./thread-bundle";
import { createTurnBundle } from "./turn-bundle";

export interface ChatPanelSessionGraph {
  connection: {
    manager: ConnectionManager;
    controller: ChatPanelConnectionBundle["connection"]["controller"];
  };
  thread: {
    resume: ResumeActions;
    restoration: RestorationController;
    identity: ActiveThreadIdentitySync;
  };
  composer: {
    controller: ChatComposerController;
  };
  shell: ChatPanelShellBundle;
  actions: {
    invalidateThreadWork(): void;
    refreshSharedThreads(): Promise<void>;
    startNewThread(): Promise<void>;
    dispose(): void;
  };
  runtime: {
    sharedState: ChatPanelSharedStateBinding;
    refreshLiveState(): void;
    deferLiveStateRefresh(): void;
  };
}

interface ChatPanelSessionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

interface ChatPanelSessionGraphHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  connectionWork: ConnectionWorkTracker;
  messageScrollController: ChatMessageScrollController;
  getClosing: () => boolean;
  viewWindow: () => Window;
}

export function createChatPanelSessionGraph(host: ChatPanelSessionGraphHost): ChatPanelSessionGraph {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  const status = createSessionStatus(stateStore, localItemIds);
  const refreshTabHeader = () => {
    host.environment.view.refreshTabHeader();
  };
  const refreshLiveState = () => {
    host.environment.plugin.workspace.refreshThreadsViewLiveState();
  };
  const deferLiveStateRefresh = () => {
    host.viewWindow().setTimeout(refreshLiveState, 0);
  };
  const notifyActiveThreadIdentityChanged = () => {
    refreshTabHeader();
    host.environment.obsidian.requestWorkspaceLayoutSave();
    refreshLiveState();
  };

  const threadFoundation = createThreadFoundation(host, {
    currentClient,
    localItemIds,
    status,
    refreshLiveState,
  });
  const connectionBundle = createConnectionBundle(
    {
      environment,
      stateStore,
      connectionWork: host.connectionWork,
      deferredTasks: host.deferredTasks,
      invalidateThreadWork: () => {
        threadFoundation.invalidateThreadWork();
      },
      deferLiveStateRefresh,
      refreshTabHeader,
      refreshLiveState,
    },
    {
      connection,
      currentClient,
      localItemIds,
      goalSync: threadFoundation.goalSync,
      autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
      status,
    },
  );
  const {
    connection: { controller: connectionController },
    inboundHandler,
  } = connectionBundle;
  const { threads: serverThreads } = connectionBundle.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const connectedClient = async () => {
    await ensureConnected();
    return currentClient();
  };
  const refreshActiveThreads = () => connectionController.refreshActiveThreads();
  const runtime = createRuntimeBundle(host, {
    connection,
    currentClient,
    status,
  });
  const threadLifecycle = createThreadLifecycleBundle(host, {
    currentClient,
    localItemIds,
    connectedClient,
    ensureConnected,
    status,
    serverThreads,
    foundation: threadFoundation,
    refreshTabHeader,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  });
  const composer = createComposerBundle(host, {
    threadLifecycle: threadLifecycle.lifecycle,
    runtimeSettings: runtime.settings,
  });
  const threadActions = createThreadActionBundle(host, {
    currentClient,
    connectedClient,
    status,
    composerController: composer.controller,
    foundation: threadFoundation,
    lifecycle: threadLifecycle,
    refreshActiveThreads,
    notifyActiveThreadIdentityChanged,
  });
  const turn = createTurnBundle(host, {
    connection,
    localItemIds,
    ensureConnected,
    connectedClient,
    currentClient,
    status,
    inboundHandler,
    threadLifecycle: threadLifecycle.lifecycle,
    threadActions: threadActions.actions,
    navigation: threadActions.navigation,
    composerController: composer.controller,
    runtimeSettings: runtime.settings,
    serverThreads,
    goals: threadLifecycle.goals,
    autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
    invalidateThreadWork: () => {
      threadFoundation.invalidateThreadWork();
    },
    runtimeProjection: runtime.projection,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  });
  const shell = createShellBundle(host, {
    connection,
    connectionController,
    goals: threadLifecycle.goals,
    rename: threadLifecycle.rename,
    threadActions: threadActions.actions,
    toolbarPanelActions: threadActions.toolbarPanelActions,
    navigation: threadActions.navigation,
    reconnect: turn.reconnect,
    history: threadFoundation.history,
    pendingRequests: turn.pendingRequests,
    turn,
    composer,
  });
  const refreshSharedThreads = async (): Promise<void> => {
    try {
      await connectionBundle.refreshSharedThreads();
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      throw error;
    }
  };
  const sharedState = createChatPanelSharedStateBinding({
    stateStore,
    threadCatalog: environment.plugin.threadCatalog,
    appServerQueries: environment.plugin.appServerQueries,
    serverActions: connectionBundle.serverActions,
    refreshTabHeader,
  });

  return {
    connection: {
      manager: connection,
      controller: connectionController,
    },
    thread: {
      resume: threadLifecycle.resume,
      restoration: threadLifecycle.restoration,
      identity: threadLifecycle.identity,
    },
    composer: {
      controller: composer.controller,
    },
    shell,
    actions: {
      invalidateThreadWork: () => {
        threadFoundation.invalidateThreadWork();
      },
      refreshSharedThreads,
      startNewThread: () => threadActions.navigation.startNewThread(),
      dispose: () => {
        shell.dispose();
        composer.dispose();
      },
    },
    runtime: {
      sharedState,
      refreshLiveState,
      deferLiveStateRefresh,
    },
  };
}

function createConnectionManager(environment: ChatPanelEnvironment): ConnectionManager {
  return new ConnectionManager(() => environment.plugin.settingsRef.settings.codexPath, environment.plugin.settingsRef.vaultPath);
}

function createSessionStatus(stateStore: ChatStateStore, localItemIds: LocalIdSource): ChatPanelSessionStatus {
  return {
    set: (statusText, phase) => {
      dispatch(stateStore, { type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
    },
    addSystemMessage: (text) => {
      dispatch(stateStore, { type: "message-stream/system-item-added", item: createSystemItem(localItemIds.next("system"), text) });
    },
    addStructuredSystemMessage: (text, details) => {
      dispatch(stateStore, {
        type: "message-stream/system-item-added",
        item: createStructuredSystemItem(localItemIds.next("system"), text, details),
      });
    },
  };
}

function dispatch(stateStore: ChatStateStore, action: ChatAction): void {
  stateStore.dispatch(action);
}
