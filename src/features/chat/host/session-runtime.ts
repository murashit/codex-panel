import { codexPanelAppServerInitializeParams } from "../../../app-server/connection/client-profile";
import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import { createChatAppServerGateway } from "../app-server/session-gateway";
import { reconnectPanel } from "../application/connection/reconnect-actions";
import { createLocalIdSource, type LocalIdSource } from "../application/local-id-source";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatAction, ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import { createEphemeralThreadLifecycle, type EphemeralThreadLifecycle } from "../application/threads/ephemeral-thread-lifecycle";
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
  };
  composer: {
    controller: ChatComposerController;
  };
  shell: ChatPanelShellBundle;
  actions: {
    invalidateThreadWork(): void;
    reconnect(): Promise<void>;
    refreshSharedThreads(): Promise<void>;
    startNewThread(): Promise<void>;
  };
  runtime: {
    sharedState: ChatPanelSharedStateBinding;
    refreshLiveState(): void;
    deferLiveStateRefresh(): void;
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
  viewWindow: () => Window;
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
    this.runtime.refreshLiveState();
    this.runtime.deferLiveStateRefresh();
  }
}

function composeChatPanelSessionRuntime(host: ChatPanelSessionRuntimeHost): ChatPanelSessionRuntimeParts {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  let ensureConnected = (): Promise<void> => Promise.reject(new Error("Codex app-server connection actions are not initialized."));
  const appServer = createChatAppServerGateway({
    codexPath: () => environment.plugin.settingsRef.settings.codexPath(),
    vaultPath: environment.plugin.settingsRef.vaultPath,
    currentClient,
    connectedClient: async () => {
      await ensureConnected();
      return currentClient();
    },
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
      appServer,
      localItemIds,
      autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
      status,
    },
  );
  const {
    connection: { actions: connectionActions },
    inboundHandler,
  } = connectionBundle;
  ensureConnected = () => connectionActions.ensureConnected();
  const refreshActiveThreads = () => connectionActions.refreshActiveThreads();
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
      environment.plugin.threadCatalog.apply({ type: "thread-started", thread });
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
    refreshTabHeader,
    refreshLiveState,
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
  const threadActions = createThreadActionBundle(host, {
    appServer,
    status,
    composerController,
    foundation: threadFoundation,
    lifecycle: threadLifecycle,
    refreshActiveThreads,
    notifyActiveThreadIdentityChanged,
    prepareForPersistentNavigation: () => ephemeral.prepareForPersistentNavigation(),
  });
  const reconnect = () =>
    reconnectPanel({
      stateStore,
      invalidateConnectionWork: () => {
        connectionActions.invalidate();
      },
      invalidateThreadWork: () => {
        threadFoundation.invalidateThreadWork();
      },
      clearDeferredDiagnostics: () => {
        host.deferredTasks.clearDiagnostics();
      },
      resetConnection: () => {
        connectionBundle.invalidateConnectionScope();
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
    threadStart,
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
    applyAppServerMetadata: connectionBundle.sharedStateActions.applyAppServerMetadata,
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
    },
    composer: {
      controller: composerController,
    },
    shell,
    actions: {
      invalidateThreadWork: () => {
        threadFoundation.invalidateThreadWork();
      },
      reconnect,
      refreshSharedThreads,
      startNewThread: () => threadActions.navigation.startNewThread(),
    },
    runtime: {
      sharedState,
      refreshLiveState,
      deferLiveStateRefresh,
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
    () => environment.plugin.settingsRef.settings.codexPath(),
    environment.plugin.settingsRef.vaultPath,
    codexPanelAppServerInitializeParams(),
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
