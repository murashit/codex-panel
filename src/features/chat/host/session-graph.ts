import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import { createChatAppServerGateway } from "../app-server/session-gateway";
import type { ConnectionWorkTracker } from "../application/connection/connection-work";
import { reconnectPanel } from "../application/connection/reconnect-actions";
import { createLocalIdSource, type LocalIdSource } from "../application/local-id-source";
import type { ChatAction, ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeActions } from "../application/threads/resume-actions";
import type { ChatResumeWorkTracker } from "../application/threads/resume-work";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import type { ChatComposerController } from "../panel/composer-controller";
import type { ChatMessageStreamScrollBinding } from "../panel/message-stream-scroll-binding";
import { createChatComposerController } from "./bundles/composer-bundle";
import { type ChatPanelConnectionBundle, createConnectionBundle } from "./bundles/connection-bundle";
import { createRuntimeBundle } from "./bundles/runtime-bundle";
import { type ChatPanelShellBundle, createShellBundle } from "./bundles/shell-bundle";
import { createThreadActionBundle, createThreadFoundation, createThreadLifecycleBundle } from "./bundles/thread-bundle";
import { createTurnBundle } from "./bundles/turn-bundle";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatViewDeferredTasks } from "./session/deferred-work";
import { type ChatPanelSharedStateBinding, createChatPanelSharedStateBinding } from "./session/shared-state-binding";

export interface ChatPanelSessionGraph {
  connection: {
    manager: ConnectionManager;
    actions: ChatPanelConnectionBundle["connection"]["actions"];
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
  messageScrollBinding: ChatMessageStreamScrollBinding;
  getClosing: () => boolean;
  viewWindow: () => Window;
}

export function createChatPanelSessionGraph(host: ChatPanelSessionGraphHost): ChatPanelSessionGraph {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  let ensureConnected: () => Promise<void> = async () => {
    throw new Error("Codex app-server connection actions are not initialized.");
  };
  const connectedClient = async () => {
    await ensureConnected();
    return currentClient();
  };
  const appServer = createChatAppServerGateway({
    codexPath: () => environment.plugin.settingsRef.settings.codexPath(),
    vaultPath: environment.plugin.settingsRef.vaultPath,
    currentClient,
    connectedClient,
  });
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
    appServer,
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
    connection: { actions: connectionActions },
    inboundHandler,
  } = connectionBundle;
  const { threads: serverThreads } = connectionBundle.serverActions;
  ensureConnected = () => connectionActions.ensureConnected();
  const refreshActiveThreads = () => connectionActions.refreshActiveThreads();
  const runtime = createRuntimeBundle(host, {
    connection,
    appServer,
    status,
  });
  const threadLifecycle = createThreadLifecycleBundle(host, {
    appServer,
    localItemIds,
    ensureConnected,
    status,
    serverThreads,
    foundation: threadFoundation,
    refreshTabHeader,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  });
  const composerController = createChatComposerController(host, {
    runtimeSettings: runtime.settings,
  });
  const threadActions = createThreadActionBundle(host, {
    appServer,
    status,
    composerController,
    foundation: threadFoundation,
    lifecycle: threadLifecycle,
    refreshActiveThreads,
    notifyActiveThreadIdentityChanged,
  });
  const reconnect = () =>
    reconnectPanel({
      stateStore,
      invalidateConnectionWork: () => {
        host.connectionWork.invalidate();
      },
      invalidateThreadWork: () => {
        threadFoundation.invalidateThreadWork();
      },
      clearDeferredDiagnostics: () => {
        host.deferredTasks.clearDiagnostics();
      },
      resetConnection: () => {
        connection.resetConnection();
      },
      setStatus: (statusText, phase) => {
        status.set(statusText, phase);
      },
      ensureConnected,
      resumeThread: (threadId) => threadLifecycle.resume.resumeThread(threadId),
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
    });
  const turn = createTurnBundle(host, {
    localItemIds,
    appServer,
    status,
    inboundHandler,
    threadLifecycle: threadLifecycle.lifecycle,
    threadActions: threadActions.actions,
    navigation: threadActions.navigation,
    composerController,
    runtimeSettings: runtime.settings,
    serverThreads,
    goals: threadLifecycle.goals,
    autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
    reconnect,
    runtimeProjection: runtime.projection,
    refreshDiagnostics: () => connectionActions.refreshDiagnostics(),
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  });
  const shell = createShellBundle(host, {
    connection,
    connectionActions,
    goals: threadLifecycle.goals,
    rename: threadLifecycle.rename,
    threadActions: threadActions.actions,
    toolbarPanelActions: threadActions.toolbarPanelActions,
    navigation: threadActions.navigation,
    reconnect,
    history: threadFoundation.history,
    pendingRequests: turn.pendingRequests,
    turn,
    composerController,
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
      actions: connectionActions,
    },
    thread: {
      resume: threadLifecycle.resume,
      restoration: threadLifecycle.restoration,
      identity: threadLifecycle.identity,
    },
    composer: {
      controller: composerController,
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
        composerController.dispose();
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
  return new ConnectionManager(() => environment.plugin.settingsRef.settings.codexPath(), environment.plugin.settingsRef.vaultPath);
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
