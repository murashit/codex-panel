import { Notice } from "obsidian";

import { codexPanelAppServerInitializeParams } from "../../../../app-server/connection/client-profile";
import { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import { createChatAppServerGateway, createChatCurrentAppServerGateway } from "../../app-server/session-gateway";
import { createReconnectPanelCommand } from "../../application/connection/reconnect-command";
import { createLocalIdSource, type LocalIdSource } from "../../application/local-id-source";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { createChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import { activeThreadId, type ChatConnectionPhase } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { createEphemeralThreadLifecycle } from "../../application/threads/ephemeral-thread-lifecycle";
import { createPersistentNavigationLifecycle } from "../../application/threads/persistent-navigation-lifecycle";
import type { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { createThreadStartCommand } from "../../application/threads/thread-start-command";
import { collaborationModeIntentValue } from "../../domain/runtime/intent";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../domain/runtime/labels";
import { createStructuredSystemItem, createSystemItem } from "../../domain/thread-stream/factories/system-items";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import { ChatComposerController } from "../composer/controller";
import type { ChatPanelEnvironment } from "../contracts";
import { createVaultComposerAttachmentHandler } from "../obsidian/composer-attachments.obsidian";
import { obsidianFuzzyMatcher } from "../obsidian/fuzzy-search.obsidian";
import { VaultComposerContextReferenceProvider } from "../obsidian/vault-composer-context-reference-provider.obsidian";
import { VaultNoteCandidateProvider } from "../obsidian/vault-note-candidate-provider.obsidian";
import { createChatPanelRuntimeNotices } from "../runtime/notices";
import { createChatThreadStreamDependencies } from "../thread-stream/context.obsidian";
import type { ChatThreadStreamScrollBinding } from "../thread-stream/scroll-binding";
import { createToolbarUiActions } from "../toolbar/actions";
import { toolbarOutsidePointerHit } from "../toolbar/hit-test.dom";
import { createSessionConnection } from "./connection";
import type { ChatViewDeferredTasks } from "./deferred-work";
import { createSessionThreadCommands, createSessionThreadFeatures, createSessionThreadFoundation } from "./thread";
import { createSessionTurn } from "./turn";

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
  activatePersistentThread: (threadId: string) => Promise<void>;
}

export function createChatPanelSessionRuntime(host: ChatPanelSessionRuntimeHost) {
  const { environment, stateStore } = host;
  const sharedResources = {
    runtimeConfigSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("runtimeConfig"),
    rateLimitsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("rateLimits"),
    modelsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("models"),
    skillsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("skills"),
    metadataDiagnosticsSnapshot: () => environment.plugin.appServerQueries.metadataDiagnosticsSnapshot(),
  };
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

  const threadFoundation = createSessionThreadFoundation(host, {
    appServer: currentAppServer,
    localItemIds,
    status,
  });
  const invalidateThreadWork = (): void => {
    threadFoundation.invalidateActiveThreadWork();
  };
  const sessionConnection = createSessionConnection(
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
  const { coordinator: connectionCoordinator, inboundHandler } = sessionConnection;
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
      runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, sharedResources),
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
    sharedResources,
  });
  const threadStart = createThreadStartCommand({
    stateStore,
    effects: appServer.threadStart,
    runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, sharedResources),
    recordStartedThread: (thread) => {
      environment.plugin.threadFacts.apply({ type: "thread-upserted", thread });
    },
    syncThreadGoal: (threadId) => {
      void threadFoundation.goalSync.syncThreadGoal(threadId);
    },
  });
  const threadFeatures = createSessionThreadFeatures(host, {
    appServer,
    localItemIds,
    ensureConnected,
    status,
    threadStart,
    foundation: threadFoundation,
    notifyActiveThreadIdentityChanged,
  });
  const composerController = new ChatComposerController({
    fuzzyMatcher: obsidianFuzzyMatcher,
    noteCandidateProvider: new VaultNoteCandidateProvider(environment.obsidian.app),
    contextReferenceProvider: new VaultComposerContextReferenceProvider(environment.obsidian.app, environment.obsidian.isForeground),
    attachmentHandler: createVaultComposerAttachmentHandler({
      app: environment.obsidian.app,
      attachmentFolder: () => environment.plugin.settings.attachmentFolder(),
    }),
    sourcePath: () => environment.obsidian.app.workspace.getActiveFile()?.path ?? "",
    stateStore,
    viewId: environment.obsidian.viewId,
    referenceActiveNoteOnSend: () => environment.plugin.settings.referenceActiveNoteOnSend(),
    sendShortcut: () => environment.plugin.settings.sendShortcut(),
    scrollThreadFromComposerEdges: () => environment.plugin.settings.scrollThreadFromComposerEdges(),
    runtimeActions: {
      requestModel: (modelId) => runtimeSettings.requestModelFromUi(modelId),
      requestReasoningEffort: (effort) => runtimeSettings.requestReasoningEffortFromUi(effort),
    },
    threadScrollFromComposer: (action) => {
      host.threadStreamScrollBinding.scrollFromComposer(action);
    },
    togglePlan: () => void runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
    toggleFast: () => void runtimeSettings.toggleFastMode(),
    canFocus: environment.obsidian.isForeground,
    onAttachmentError: (message) => {
      new Notice(message);
    },
    sharedResources: {
      runtimeConfigSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("runtimeConfig"),
      rateLimitsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("rateLimits"),
      modelsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("models"),
      skillsSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("skills"),
      permissionProfilesSnapshot: () => environment.plugin.appServerQueries.metadataSnapshot("permissionProfiles"),
      activeThreadsSnapshot: () => environment.plugin.threadCatalog.activeThreadsSnapshot(),
      subscribe: (listener) => {
        const unsubscribers = [
          environment.plugin.appServerQueries.observeMetadataResource("runtimeConfig", listener),
          environment.plugin.appServerQueries.observeMetadataResource("models", listener),
          environment.plugin.appServerQueries.observeMetadataResource("skills", listener),
          environment.plugin.appServerQueries.observeMetadataResource("permissionProfiles", listener),
          environment.plugin.threadCatalog.observeActiveThreadsResult(listener),
        ];
        return () => {
          for (const unsubscribe of unsubscribers) unsubscribe();
        };
      },
    },
  });
  const ephemeral = createEphemeralThreadLifecycle({
    stateStore,
    effects: appServer.threadEphemeral,
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
    unsubscribeThread: (threadId) => appServer.threadSubscription.unsubscribeThread(threadId),
    addSystemMessage: status.addSystemMessage,
  });
  const threadCommands = createSessionThreadCommands(host, {
    appServer,
    ensureConnected,
    status,
    composerController,
    foundation: threadFoundation,
    features: threadFeatures,
    navigation,
    activatePersistentThread: host.activatePersistentThread,
  });
  const reconnectHost = {
    stateStore,
    resetConnectionScope: () => {
      connectionCoordinator.invalidate();
      invalidateThreadWork();
      host.deferredTasks.clearDiagnostics();
      sessionConnection.invalidateConnectionScope();
      connection.disconnect();
    },
    setStatus: (statusText: string, phase?: ChatConnectionPhase) => {
      status.set(statusText, phase);
    },
    ensureConnected,
    isConnected: () => connection.isConnected(),
    resumeThread: (threadId: string) => threadFeatures.resume.resumeThread(threadId),
    addSystemMessage: (text: string) => {
      status.addSystemMessage(text);
    },
  };
  const reconnectPanel = createReconnectPanelCommand(reconnectHost);
  const reconnect = async () => {
    await reconnectPanel();
  };
  const turn = createSessionTurn(host, {
    localItemIds,
    appServer,
    status,
    inboundHandler,
    threadLifecycle: threadFeatures,
    threadCommands: threadCommands.commands,
    navigation: threadCommands.navigation,
    composerController,
    runtimeSettings,
    threadStart,
    goals: threadFeatures.goals,
    autoTitleCoordinator: threadFoundation.autoTitleCoordinator,
    reconnect,
    runtimeProjection,
    refreshDiagnostics: () => connectionCoordinator.refreshDiagnostics(),
    notifyActiveThreadIdentityChanged,
  });
  const toolbarActions = createToolbarUiActions({
    connectionCoordinator,
    reconnectCommand: reconnect,
    threadCommands: threadCommands.commands,
    goals: threadFeatures.goals,
    toolbarPanel: threadCommands.toolbarPanelActions,
    rename: threadFeatures.rename,
    navigation: threadCommands.navigation,
    loadMoreThreads: () => environment.plugin.threadCatalog.loadMoreActiveThreads(),
    openSideChat: () => {
      const state = stateStore.getState();
      if (activePanelOperationDecision(state, "start-side-chat").kind !== "allowed") return;
      const threadId = activeThreadId(state);
      if (!threadId) return;
      const thread = environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId);
      void environment.plugin.workspace.openSideChat(threadId, thread?.name ?? thread?.preview ?? null);
    },
    debugDetails: {
      stateStore,
      connected: () => connection.isConnected(),
      vaultPath: () => environment.plugin.appServerContext.vaultPath,
      configuredCommand: () => environment.plugin.appServerContext.codexPath,
      runtimeConfig: () => environment.plugin.appServerQueries.metadataSnapshot("runtimeConfig"),
      rateLimit: () => environment.plugin.appServerQueries.metadataSnapshot("rateLimits"),
      availableModels: () => environment.plugin.appServerQueries.metadataSnapshot("models") ?? [],
      metadataDiagnostics: () => environment.plugin.appServerQueries.metadataDiagnosticsSnapshot(),
    },
  });
  const toolbarDependencies = {
    connection: {
      connected: () => connection.isConnected(),
    },
    settings: {
      vaultPath: () => environment.plugin.appServerContext.vaultPath,
      configuredCommand: () => environment.plugin.appServerContext.codexPath,
      archiveExportEnabled: () => environment.plugin.settings.archiveExportEnabled(),
    },
  };
  const goalDependencies = {
    sendShortcut: () => environment.plugin.settings.sendShortcut(),
    actions: threadFeatures.goals,
  };
  const threadStreamContext = createChatThreadStreamDependencies({
    panelId: environment.obsidian.viewId,
    app: environment.obsidian.app,
    owner: environment.obsidian.owner,
    stateStore,
    vaultPath: environment.plugin.appServerContext.vaultPath,
    loadOlderTurns: () => void threadFoundation.history.loadOlder(),
    actions: {
      rollbackThread: (threadId) => void threadCommands.commands.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) =>
        void threadCommands.commands.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turn.submissionCommands.planImplementation.implement(itemId),
      openThreadInAvailableView: (threadId) => void environment.plugin.workspace.openThreadInAvailableView(threadId),
      openThreadInNewView: (threadId) => void environment.plugin.workspace.openThreadInNewView(threadId),
      openTurnDiff: (state) => void environment.plugin.workspace.openTurnDiff(state),
    },
    requests: turn.pendingRequests,
  });
  const shell = {
    parts: {
      toolbar: {
        dependencies: toolbarDependencies,
        actions: toolbarActions,
      },
      goal: goalDependencies,
      threadStream: {
        context: threadStreamContext,
        scrollPortBinding: host.threadStreamScrollBinding,
      },
      composer: {
        presenter: composerController,
        actions: {
          submit: () => void turn.submissionCommands.composerSubmit.submit(),
        },
      },
    },
    closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => {
      threadCommands.toolbarPanelActions.closeOnOutsidePointer({
        hit: toolbarOutsidePointerHit(event, environment.view.panelRoot(), environment.view.viewWindow()),
        renameEditing: threadFeatures.rename.isEditing(),
      });
    },
  };
  const refreshSharedThreads = (): Promise<void> => sessionConnection.refreshSharedThreads();
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
      threadFeatures.restoration.invalidate();
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
      resume: threadFeatures.resume,
      restoration: threadFeatures.restoration,
      identity: threadFeatures.identity,
      ensureRestoredThreadLoaded: threadFeatures.ensureRestoredThreadLoaded,
      ephemeral,
      navigation,
    },
    composer: {
      controller: composerController,
    },
    turn,
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
      sessionConnection.invalidateConnectionScope();
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
