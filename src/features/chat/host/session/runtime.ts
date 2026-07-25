import { codexPanelAppServerInitializeParams } from "../../../../app-server/connection/client-profile";
import { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import { isStaleExecutionRuntimeError } from "../../../../shared/runtime/execution-runtime-lifetime";
import { createChatAppServerGateway, createChatCurrentAppServerGateway } from "../../app-server/session-gateway";
import { createReconnectPanelCommand } from "../../application/connection/reconnect-command";
import { createLocalIdSource, type LocalIdSource } from "../../application/local-id-source";
import { createChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatConnectionPhase } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { createEphemeralThreadLifecycle } from "../../application/threads/ephemeral-thread-lifecycle";
import { createPersistentNavigationLifecycle } from "../../application/threads/persistent-navigation-lifecycle";
import type { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { createThreadStartCommand } from "../../application/threads/thread-start-command";
import { collaborationModeIntentValue } from "../../domain/runtime/intent";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../domain/runtime/labels";
import { createStructuredSystemItem, createSystemItem } from "../../domain/thread-stream/factories/system-items";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import { createChatPanelRuntimeNotices } from "../../panel/runtime/notices";
import type { ChatThreadStreamScrollBinding } from "../../panel/thread-stream/scroll-binding";
import { createChatComposerController } from "../bundles/composer-bundle";
import { createConnectionBundle } from "../bundles/connection-bundle";
import { createShellBundle } from "../bundles/shell-bundle";
import { createThreadCommandBundle, createThreadFoundation, createThreadLifecycleBundle } from "../bundles/thread-bundle";
import { createTurnBundle } from "../bundles/turn-bundle";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatViewDeferredTasks } from "./deferred-work";

interface ChatPanelSessionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
}

interface ChatPanelSessionRuntimeHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  threadStreamScrollBinding: ChatThreadStreamScrollBinding;
  getClosing: () => boolean;
}

export function createChatPanelSessionRuntime(host: ChatPanelSessionRuntimeHost) {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const resourceContext = environment.plugin.appServerContext;
  const connection = new ConnectionManager(resourceContext.codexPath, resourceContext.vaultPath, codexPanelAppServerInitializeParams());
  const currentClient = () => connection.currentClient();
  const currentAppServer = createChatCurrentAppServerGateway({
    fallbackClientAccess: environment.plugin.appServerClientAccess,
    vaultPath: resourceContext.vaultPath,
    currentClient,
  });
  const status = createSessionStatus(stateStore, localItemIds);
  const refreshTabHeader = () => {
    host.environment.view.refreshTabHeader();
  };
  const notifyActiveThreadIdentityChanged = () => {
    refreshTabHeader();
    host.environment.obsidian.requestWorkspaceLayoutSave();
  };

  const threadFoundation = createThreadFoundation(host, {
    appServer: currentAppServer,
    localItemIds,
    status,
  });
  const invalidateThreadWork = (): void => {
    threadFoundation.invalidateActiveThreadWork();
  };
  const connectionBundle = createConnectionBundle(
    {
      environment,
      stateStore,
      canConnect: () => !host.getClosing(),
      deferredTasks: host.deferredTasks,
      invalidateThreadWork,
      refreshTabHeader,
    },
    {
      connection,
      diagnosticsPort: currentAppServer.serverDiagnostics,
      localItemIds,
      autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
      status,
    },
  );
  const {
    connection: { coordinator: connectionCoordinator },
    inboundHandler,
  } = connectionBundle;
  const ensureConnected = () => connectionCoordinator.ensureConnected();
  const appServer = createChatAppServerGateway(currentAppServer, {
    vaultPath: resourceContext.vaultPath,
    currentClient,
    connectedClient: async () => {
      if (host.getClosing()) return null;
      await connectionCoordinator.ensureConnected();
      if (host.getClosing()) return null;
      return currentClient();
    },
  });
  const runtimeSettings = createChatRuntimeSettingsCommands(
    {
      stateStore,
      runtimeSettingsPort: appServer.runtimeSettings,
      runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, environment.plugin.appServerQueries),
      collaborationModeLabel: () => {
        const runtime = stateStore.getState().runtime;
        return formatCollaborationModeLabel(
          collaborationModeIntentValue(runtime.pending.collaborationMode, runtime.active.collaborationMode),
        );
      },
      addSystemMessage: status.addSystemMessage,
    },
    environment.plugin.runtimeSettingsCommitQueue,
  );
  const runtimeProjection = createChatPanelRuntimeNotices({
    state: () => stateStore.getState(),
    connected: () => connection.isConnected(),
    configuredCommand: () => environment.plugin.appServerContext.codexPath,
    vaultPath: () => environment.plugin.appServerContext.vaultPath,
    sharedResources: environment.plugin.appServerQueries,
  });
  const threadStart = createThreadStartCommand({
    stateStore,
    threadStartPort: appServer.threadStart,
    runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, environment.plugin.appServerQueries),
    recordStartedThread: (thread) => {
      environment.plugin.threadFacts.apply({ type: "thread-upserted", thread });
    },
    syncThreadGoal: (threadId) => {
      void threadFoundation.goalSync.syncThreadGoal(threadId);
    },
  });
  const threadLifecycle = createThreadLifecycleBundle(host, {
    appServer,
    localItemIds,
    ensureConnected,
    ensureInitialized: () => connectionCoordinator.ensureInitialized(),
    status,
    threadStart,
    foundation: threadFoundation,
    notifyActiveThreadIdentityChanged,
  });
  const composerController = createChatComposerController(host, {
    runtimeSettings,
  });
  const ephemeral = createEphemeralThreadLifecycle({
    stateStore,
    port: appServer.threadEphemeral,
    ensureConnected: async () => {
      await ensureConnected();
      return connection.isConnected();
    },
    addSystemMessage: status.addSystemMessage,
    notifyActiveThreadIdentityChanged,
    interruptTurn: (threadId, turnId) => appServer.turn.interruptTurn(threadId, turnId),
  });
  const navigation = createPersistentNavigationLifecycle({
    stateStore,
    ephemeral,
    subscriptions: appServer.threadSubscription,
    addSystemMessage: status.addSystemMessage,
  });
  const threadCommands = createThreadCommandBundle(host, {
    appServer,
    status,
    composerController,
    foundation: threadFoundation,
    lifecycle: threadLifecycle,
    notifyActiveThreadIdentityChanged,
    navigation,
  });
  const reconnectHost = {
    stateStore,
    resetConnectionScope: () => {
      connectionCoordinator.invalidate();
      invalidateThreadWork();
      host.deferredTasks.clearDiagnostics();
      connectionBundle.invalidateConnectionScope();
      connection.disconnect();
    },
    setStatus: (statusText: string, phase?: ChatConnectionPhase) => {
      status.set(statusText, phase);
    },
    ensureConnected,
    isConnected: () => connection.isConnected(),
    resumeThread: (threadId: string) => threadLifecycle.resume.resumeThread(threadId),
    addSystemMessage: (text: string) => {
      status.addSystemMessage(text);
    },
  };
  const reconnectPanel = createReconnectPanelCommand(reconnectHost);
  const reconnect = async () => {
    await reconnectPanel();
  };
  const turn = createTurnBundle(host, {
    localItemIds,
    appServer,
    status,
    inboundHandler,
    threadLifecycle,
    threadCommands: threadCommands.commands,
    navigation: threadCommands.navigation,
    composerController,
    runtimeSettings,
    threadStart,
    goals: threadLifecycle.goals,
    autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
    reconnect,
    runtimeProjection,
    refreshDiagnostics: () => connectionCoordinator.refreshDiagnostics(),
    notifyActiveThreadIdentityChanged,
  });
  const shell = createShellBundle(host, {
    connection,
    connectionCoordinator,
    goals: threadLifecycle.goals,
    rename: threadLifecycle.rename,
    threadCommands: threadCommands.commands,
    toolbarPanelActions: threadCommands.toolbarPanelActions,
    navigation: threadCommands.navigation,
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
      if (isStaleExecutionRuntimeError(error)) return;
      throw error;
    }
  };
  let unsubscribeSharedThreads: (() => void) | null = null;
  const threadCatalogObserver = {
    subscribe: () => {
      unsubscribeSharedThreads?.();
      unsubscribeSharedThreads = environment.plugin.threadCatalog.observeActiveThreadsResult(() => {
        refreshTabHeader();
      });
    },
    unsubscribe: () => {
      unsubscribeSharedThreads?.();
      unsubscribeSharedThreads = null;
    },
  };

  const commands = {
    invalidateThreadWork: () => {
      invalidateThreadWork();
      threadLifecycle.restoration.invalidate();
    },
    reconnect,
    refreshSharedThreads,
    startNewThread: (options?: { focus?: boolean }) => threadCommands.navigation.startNewThread(options),
  };

  return {
    connection: {
      manager: connection,
      coordinator: connectionCoordinator,
    },
    thread: {
      resume: threadLifecycle.resume,
      restoration: threadLifecycle.restoration,
      identity: threadLifecycle.identity,
      ephemeral,
      navigation,
    },
    composer: {
      controller: composerController,
    },
    shell,
    commands,
    observers: {
      threadCatalog: threadCatalogObserver,
    },
    dispose: async (unmount: () => void): Promise<void> => {
      connection.disconnect();
      connectionCoordinator.invalidate();
      commands.invalidateThreadWork();
      host.deferredTasks.clearAll();
      threadCatalogObserver.unsubscribe();
      connectionBundle.invalidateConnectionScope();
      composerController.dispose();
      host.threadStreamScrollBinding.dispose();
      unmount();
      await ephemeral.dispose();
    },
  } as const;
}

function createSessionStatus(stateStore: ChatStateStore, localItemIds: LocalIdSource): ChatPanelSessionStatus {
  return {
    set: (statusText, phase) => {
      stateStore.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
    },
    addSystemMessage: (text) => {
      stateStore.dispatch({
        type: "thread-stream/system-item-added",
        item: createSystemItem(localItemIds.next("system"), text),
      });
    },
    addStructuredSystemMessage: (text, details) => {
      stateStore.dispatch({
        type: "thread-stream/system-item-added",
        item: createStructuredSystemItem(localItemIds.next("system"), text, details),
      });
    },
  };
}
