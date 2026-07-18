import { codexPanelAppServerInitializeParams } from "../../../app-server/connection/client-profile";
import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerResourceContextError } from "../../../app-server/query/resource-store";
import { createChatAppServerGateway, createChatCurrentAppServerGateway } from "../app-server/session-gateway";
import { reconnectPanel } from "../application/connection/reconnect-actions";
import { createLocalIdSource, type LocalIdSource } from "../application/local-id-source";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatAction, ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import { createEphemeralThreadLifecycle, type EphemeralThreadLifecycle } from "../application/threads/ephemeral-thread-lifecycle";
import {
  createPersistentNavigationLifecycle,
  type PersistentNavigationLifecycle,
} from "../application/threads/persistent-navigation-lifecycle";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeActions } from "../application/threads/resume-actions";
import type { ChatResumeWorkTracker } from "../application/threads/resume-work";
import { createThreadStartActions } from "../application/threads/thread-start-actions";
import { createStructuredSystemItem, createSystemItem } from "../domain/thread-stream/factories/system-items";
import type { ThreadStreamNoticeSection } from "../domain/thread-stream/items";
import type { ChatComposerController } from "../panel/composer-controller";
import type { ChatThreadStreamScrollBinding } from "../panel/thread-stream-scroll-binding";
import { createChatComposerController } from "./bundles/composer-bundle";
import { type ChatPanelConnectionBundle, createConnectionBundle } from "./bundles/connection-bundle";
import { createRuntimeBundle } from "./bundles/runtime-bundle";
import { type ChatPanelShellBundle, createShellBundle } from "./bundles/shell-bundle";
import { createThreadActionBundle, createThreadFoundation, createThreadLifecycleBundle } from "./bundles/thread-bundle";
import { createTurnBundle } from "./bundles/turn-bundle";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatViewDeferredTasks } from "./session/deferred-work";
import { type ChatPanelSharedStateBinding, createChatPanelSharedStateBinding } from "./session/shared-state-binding";

interface ChatPanelSessionRuntimeParts {
  connection: {
    manager: ConnectionManager;
    actions: ChatPanelConnectionBundle["connection"]["actions"];
  };
  thread: {
    resume: ResumeActions;
    restoration: RestorationController;
    identity: ActiveThreadIdentitySync;
    ephemeral: EphemeralThreadLifecycle;
    navigation: PersistentNavigationLifecycle;
  };
  composer: {
    controller: ChatComposerController;
  };
  shell: ChatPanelShellBundle;
  actions: {
    invalidateThreadWork(): void;
    prepareAppServerContextChange(): void;
    reconnect(): Promise<void>;
    reconnectAfterAppServerContextChange(threadId: string | null, isCurrent: () => boolean): Promise<boolean>;
    refreshSharedThreads(): Promise<void>;
    startNewThread(options?: { focus?: boolean }): Promise<void>;
  };
  runtime: {
    sharedState: ChatPanelSharedStateBinding;
  };
  disposeOwnedResources: () => void;
}

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
  reconnect?: () => Promise<void>;
}

export class ChatPanelSessionRuntime {
  readonly connection: ChatPanelSessionRuntimeParts["connection"];
  readonly thread: ChatPanelSessionRuntimeParts["thread"];
  readonly composer: ChatPanelSessionRuntimeParts["composer"];
  readonly shell: ChatPanelSessionRuntimeParts["shell"];
  readonly actions: ChatPanelSessionRuntimeParts["actions"];
  readonly runtime: ChatPanelSessionRuntimeParts["runtime"];
  private readonly disposeOwnedResources: ChatPanelSessionRuntimeParts["disposeOwnedResources"];

  constructor(private readonly host: ChatPanelSessionRuntimeHost) {
    const parts = composeChatPanelSessionRuntime(host);
    this.connection = parts.connection;
    this.thread = parts.thread;
    this.composer = parts.composer;
    this.shell = parts.shell;
    this.actions = parts.actions;
    this.runtime = parts.runtime;
    this.disposeOwnedResources = parts.disposeOwnedResources;
  }

  async dispose(unmount: () => void): Promise<void> {
    this.connection.actions.invalidate();
    this.actions.invalidateThreadWork();
    this.host.deferredTasks.clearAll();
    this.runtime.sharedState.unsubscribe();
    await this.thread.ephemeral.dispose();
    this.disposeOwnedResources();
    unmount();
    this.connection.manager.disconnect();
  }
}

function composeChatPanelSessionRuntime(host: ChatPanelSessionRuntimeHost): ChatPanelSessionRuntimeParts {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  const resourceContext = () => environment.plugin.appServerQueries.contextLease().context;
  const currentAppServer = createChatCurrentAppServerGateway({
    codexPath: () => resourceContext().codexPath,
    vaultPath: resourceContext().vaultPath,
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
    threadFoundation.invalidateThreadWork();
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
      diagnosticsTransport: currentAppServer.serverDiagnostics,
      localItemIds,
      autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
      status,
    },
  );
  const {
    connection: { actions: connectionActions },
    inboundHandler,
  } = connectionBundle;
  const ensureConnected = () => connectionActions.ensureConnected();
  const appServer = createChatAppServerGateway(currentAppServer, {
    vaultPath: resourceContext().vaultPath,
    currentClient,
    connectedClient: async () => {
      if (host.getClosing()) return null;
      await connectionActions.ensureConnected();
      if (host.getClosing()) return null;
      return currentClient();
    },
  });
  const runtime = createRuntimeBundle(host, {
    connection,
    appServer,
    status,
  });
  const threadStart = createThreadStartActions({
    stateStore,
    threadStartTransport: appServer.threadStart,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    recordStartedThread: (thread) => {
      environment.plugin.threadCatalog.apply({ type: "thread-upserted", thread });
    },
    syncThreadGoal: (threadId) => {
      void threadFoundation.goalSync.syncThreadGoal(threadId);
    },
  });
  const threadLifecycle = createThreadLifecycleBundle(host, {
    appServer,
    localItemIds,
    ensureConnected,
    status,
    threadStart,
    foundation: threadFoundation,
    notifyActiveThreadIdentityChanged,
  });
  const composerController = createChatComposerController(host, {
    runtimeSettings: runtime.settings,
  });
  const ephemeral = createEphemeralThreadLifecycle({
    stateStore,
    transport: appServer.threadEphemeral,
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
  const threadActions = createThreadActionBundle(host, {
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
    invalidateConnectionWork: () => {
      connectionActions.invalidate();
    },
    invalidateThreadWork: () => {
      invalidateThreadWork();
    },
    clearDeferredDiagnostics: () => {
      host.deferredTasks.clearDiagnostics();
    },
    resetConnection: () => {
      connectionBundle.invalidateConnectionScope();
      connection.resetConnection();
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
  const reconnect = async () => {
    await reconnectPanel(reconnectHost);
  };
  const reconnectAfterAppServerContextChange = (threadId: string | null, isCurrent: () => boolean) =>
    reconnectPanel(reconnectHost, { resumeThreadId: threadId, isCurrent });
  const reconnectForUser = host.reconnect ?? reconnect;
  const prepareAppServerContextChange = (): void => {
    connectionActions.invalidate();
    invalidateThreadWork();
    threadLifecycle.rename.invalidate();
    threadLifecycle.restoration.invalidate();
    host.deferredTasks.clearDiagnostics();
    connectionBundle.invalidateConnectionScope();
    connection.resetConnection();
    stateStore.dispatch({ type: "connection/context-replaced" });
  };
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
    threadStart,
    goals: threadLifecycle.goals,
    autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
    reconnect: reconnectForUser,
    runtimeProjection: runtime.projection,
    refreshDiagnostics: () => connectionActions.refreshDiagnostics(),
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
    reconnect: reconnectForUser,
    history: threadFoundation.history,
    pendingRequests: turn.pendingRequests,
    turn,
    composerController,
  });
  const refreshSharedThreads = async (): Promise<void> => {
    try {
      await connectionBundle.refreshSharedThreads();
    } catch (error) {
      if (isStaleAppServerResourceContextError(error)) return;
      throw error;
    }
  };
  const sharedState = createChatPanelSharedStateBinding({
    stateStore,
    threadCatalog: environment.plugin.threadCatalog,
    appServerQueries: environment.plugin.appServerQueries,
    applyAppServerMetadataResource: connectionBundle.sharedStateActions.applyAppServerMetadataResource,
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
      ephemeral,
      navigation,
    },
    composer: {
      controller: composerController,
    },
    shell,
    actions: {
      invalidateThreadWork: () => {
        invalidateThreadWork();
        threadLifecycle.restoration.invalidate();
      },
      prepareAppServerContextChange,
      reconnect,
      reconnectAfterAppServerContextChange,
      refreshSharedThreads,
      startNewThread: (options) => threadActions.navigation.startNewThread(options),
    },
    runtime: {
      sharedState,
    },
    disposeOwnedResources: () => {
      connectionBundle.invalidateConnectionScope();
      shell.dispose();
      composerController.dispose();
    },
  };
}

function createConnectionManager(environment: ChatPanelEnvironment): ConnectionManager {
  return new ConnectionManager(
    () => environment.plugin.appServerQueries.contextLease().context.codexPath,
    environment.plugin.appServerQueries.contextLease().context.vaultPath,
    codexPanelAppServerInitializeParams(),
    undefined,
    () => environment.plugin.appServerQueries.contextLease().generation,
  );
}

function createSessionStatus(stateStore: ChatStateStore, localItemIds: LocalIdSource): ChatPanelSessionStatus {
  return {
    set: (statusText, phase) => {
      dispatch(stateStore, { type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
    },
    addSystemMessage: (text) => {
      dispatch(stateStore, { type: "thread-stream/system-item-added", item: createSystemItem(localItemIds.next("system"), text) });
    },
    addStructuredSystemMessage: (text, details) => {
      dispatch(stateStore, {
        type: "thread-stream/system-item-added",
        item: createStructuredSystemItem(localItemIds.next("system"), text, details),
      });
    },
  };
}

function dispatch(stateStore: ChatStateStore, action: ChatAction): void {
  stateStore.dispatch(action);
}
