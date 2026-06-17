import { Notice } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { AppServerObservedQueryResult } from "../../../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import { createThreadOperations, type ThreadOperations } from "../../threads/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../../threads/thread-title-service";
import { PendingRequestController } from "../application/pending-requests/controller";
import {
  createConversationTurnActions,
  type ConversationTurnActions as ChatPanelConversationTurnActions,
} from "../application/conversation/composition";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import { reconnectPanel, type ChatReconnectActionsHost } from "../application/connection/reconnect-actions";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { activeTurnId, chatTurnBusy, type ChatAction, type ChatConnectionPhase } from "../application/state/root-reducer";
import { messageStreamItems } from "../application/state/message-stream";
import type { ChatStateStore } from "../application/state/store";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../application/lifecycle";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import { AutoTitleController } from "../application/threads/auto-title-controller";
import { HistoryController } from "../application/threads/history-controller";
import type { IdentitySync } from "../application/threads/identity-sync";
import { createThreadLifecycleParts } from "../application/threads/lifecycle-parts";
import {
  activeThreadRenameTitleContext,
  ThreadRenameEditorController,
  type ThreadRenameEditorController as ThreadRenameEditorControllerInstance,
} from "../application/threads/rename-editor-controller";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeController } from "../application/threads/resume-controller";
import { createSelectionActions } from "../application/threads/selection-actions";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "../application/threads/thread-management-actions";
import type { ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import type { ChatServerMetadataActions } from "../app-server/actions/metadata";
import type { ChatServerThreadActions } from "../app-server/actions/threads";
import type { ChatInboundController } from "../app-server/inbound/controller";
import { ChatComposerController } from "../panel/composer-controller";
import { chatPanelComposerProjection, type ChatPanelComposerSurface } from "../panel/surface/composer-projection";
import { createChatPanelGoalSurface, type ChatPanelGoalSurface } from "../panel/surface/goal-projection";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { MessageStreamScrollBridge, type ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll";
import type { ChatPanelToolbarSurface } from "../panel/surface/toolbar-projection";
import { createChatPanelToolbarActions, createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ToolbarActions } from "../ui/toolbar";
import { pendingRequestsSignature } from "../domain/pending-requests/signatures";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";
import { normalizeExplicitThreadName, type Thread } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { archiveExportSettings } from "../../threads/archive-export-settings";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { connectionDiagnosticsModel } from "../application/connection/diagnostics-display";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../domain/local-id";
import type { RuntimeSnapshot } from "../application/runtime/snapshot";
import type { ChatPanelEnvironment } from "./runtime";
import { createConnectionBundle, type ChatPanelConnectionBundle, type CurrentAppServerClient } from "./connection-bundle";
import { VaultNoteCandidateProvider } from "../panel/vault-note-candidate-provider";

export interface ChatPanelSessionGraph {
  connection: {
    manager: ConnectionManager;
    controller: ChatPanelConnectionBundle["connection"]["controller"];
  };
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
  thread: {
    history: HistoryController;
    resume: ResumeController;
    restoration: RestorationController;
    identity: IdentitySync;
    rename: ThreadRenameEditorControllerInstance;
  };
  toolbar: {
    panels: ToolbarPanelActions;
    actions: ToolbarActions;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmitActions;
  };
  render: {
    messageStreamPresenter: MessageStreamPresenter;
  };
  surface: {
    toolbar: ChatPanelToolbarSurface;
    goal: ChatPanelGoalSurface;
    composer: ChatPanelComposerSurface;
  };
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

interface ChatPanelSharedStateBinding {
  applyCached(): void;
  subscribe(): void;
  unsubscribe(): void;
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
  messageScrollIntent: ChatMessageScrollIntentState;
  getOpened: () => boolean;
  getClosing: () => boolean;
  viewWindow: () => Window;
}

type ChatPanelGoalSyncActions = ReturnType<typeof createThreadGoalSyncActions>;
type ChatPanelRuntimeSettingsActions = ReturnType<typeof createChatRuntimeSettingsActions>;
type ChatPanelGoalActions = ReturnType<typeof createGoalActions>;
type ChatPanelThreadLifecycle = ReturnType<typeof createThreadLifecycleParts>;
type ChatPanelThreadActions = ReturnType<typeof createThreadManagementActions>;
type ChatPanelSelectionActions = ReturnType<typeof createSelectionActions>;

interface ChatPanelThreadActionParts {
  actions: ChatPanelThreadActions;
  toolbarPanels: ToolbarPanelActions;
  selection: ChatPanelSelectionActions;
}

interface ChatPanelComposerAndTurnParts {
  pendingRequests: PendingRequestController;
  reconnect: () => Promise<void>;
  turnActions: ChatPanelConversationTurnActions;
}

interface ChatPanelSurfacePresenterParts {
  toolbarActions: ToolbarActions;
  toolbarSurface: ChatPanelToolbarSurface;
  goalSurface: ChatPanelGoalSurface;
  messageStreamPresenter: MessageStreamPresenter;
}

export function createChatPanelSessionGraph(host: ChatPanelSessionGraphHost): ChatPanelSessionGraph {
  const { environment, stateStore } = host;
  const localItemIds = createLocalChatItemIdFactory();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  const status = createSessionStatus(stateStore, localItemIds);
  const titleService = createSessionThreadTitleService(host, currentClient);
  const autoTitle = createSessionAutoTitleController(host, currentClient, titleService);
  const history = createSessionHistoryController(host, currentClient, status, autoTitle);
  const invalidateThreadWork = () => {
    host.resumeWork.invalidate();
    history.invalidate();
  };
  const goalSync = createSessionGoalSyncActions(host, currentClient, status);
  const serverParts = createConnectionBundle(
    {
      environment,
      stateStore,
      connectionWork: host.connectionWork,
      deferredTasks: host.deferredTasks,
      invalidateThreadWork,
      deferLiveStateRefresh: () => {
        deferLiveStateRefresh(host);
      },
      refreshTabHeader: () => {
        refreshTabHeader(host);
      },
      refreshLiveState: () => {
        refreshLiveState(host);
      },
    },
    {
      connection,
      currentClient,
      goalSync,
      autoTitle,
      status,
    },
  );
  const {
    connection: { controller },
    inboundController,
  } = serverParts;
  const connectionController = controller;
  const { threads: serverThreads, diagnostics: serverDiagnostics } = serverParts.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const refreshActiveThreads = () => connectionController.refreshActiveThreads();
  const threadOperations = createSessionThreadOperations(environment, currentClient);
  const runtimeSettings = createSessionRuntimeSettingsActions(host, currentClient, status);
  const goals = createSessionGoalActions(host, currentClient, ensureConnected, status);
  const rename = createSessionThreadRenameEditor(stateStore, threadOperations, titleService, ensureConnected, status);
  const threadLifecycle = createSessionThreadLifecycle(
    host,
    currentClient,
    ensureConnected,
    status,
    goals,
    autoTitle,
    history,
    invalidateThreadWork,
  );
  const { identity, restoration, resume } = threadLifecycle;

  const composerSurface = createSessionComposerSurface(threadLifecycle, runtimeSettings);
  const messageStreamScrollBridge = new MessageStreamScrollBridge();
  const composerController = createSessionComposerController(host, composerSurface, runtimeSettings, messageStreamScrollBridge);
  const startNewThread = async (): Promise<void> => {
    if (chatTurnBusy(stateStore.getState())) return;

    identity.clearActiveThreadContext();
    stateStore.dispatch({ type: "ui/panel-set", panel: null });
    stateStore.dispatch({ type: "connection/status-set", statusText: "New chat." });
    composerController.focus();
  };
  const threadActionParts = createThreadActionParts(host, {
    operations: threadOperations,
    ensureConnected,
    currentClient,
    status,
    composerController,
    resume,
    refreshActiveThreads,
  });
  const composerAndTurn = createComposerAndTurnActions(host, {
    connection,
    ensureConnected,
    currentClient,
    status,
    inboundController,
    threadLifecycle,
    threadActions: threadActionParts.actions,
    selection: threadActionParts.selection,
    composerController,
    runtimeSettings,
    serverThreads,
    serverDiagnostics,
    goals,
    autoTitle,
    invalidateThreadWork,
    startNewThread,
    runtimeProjection: {
      connectionDiagnosticDetails: () => connectionDiagnosticDetails(host, connection),
      modelStatusLines: () => modelStatusLines(host),
      effortStatusLines: () => effortStatusLines(host),
      statusSummaryLines: () => statusSummaryLines(host),
    },
  });
  const surfaceAndPresenter = createSurfacesAndPresenter(host, {
    connection,
    connectionController,
    inboundController,
    serverThreads,
    goals,
    rename,
    threadActions: threadActionParts.actions,
    toolbarPanels: threadActionParts.toolbarPanels,
    selection: threadActionParts.selection,
    reconnect: composerAndTurn.reconnect,
    history,
    pendingRequests: composerAndTurn.pendingRequests,
    turnActions: composerAndTurn.turnActions,
    messageStreamScrollBridge,
    startNewThread,
  });
  const refreshSharedThreads = async (): Promise<void> => {
    try {
      await serverParts.refreshSharedThreads();
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      throw error;
    }
  };
  const dispose = (): void => {
    surfaceAndPresenter.messageStreamPresenter.dispose();
    composerController.dispose();
  };
  const sharedState = createChatPanelSharedStateBinding(host, serverParts.serverActions);

  return {
    connection: {
      manager: connection,
      controller: connectionController,
    },
    serverActions: serverParts.serverActions,
    thread: {
      history,
      resume,
      restoration,
      identity,
      rename,
    },
    toolbar: {
      panels: threadActionParts.toolbarPanels,
      actions: surfaceAndPresenter.toolbarActions,
    },
    composer: {
      controller: composerController,
      submission: composerAndTurn.turnActions.composerSubmit,
    },
    render: {
      messageStreamPresenter: surfaceAndPresenter.messageStreamPresenter,
    },
    surface: {
      toolbar: surfaceAndPresenter.toolbarSurface,
      goal: surfaceAndPresenter.goalSurface,
      composer: composerSurface,
    },
    actions: {
      invalidateThreadWork,
      refreshSharedThreads,
      startNewThread,
      dispose,
    },
    runtime: {
      sharedState,
      refreshLiveState: () => {
        refreshLiveState(host);
      },
      deferLiveStateRefresh: () => {
        deferLiveStateRefresh(host);
      },
    },
  };
}

function createConnectionManager(environment: ChatPanelEnvironment): ConnectionManager {
  return new ConnectionManager(() => environment.plugin.settingsRef.settings.codexPath, environment.plugin.settingsRef.vaultPath);
}

function createChatPanelSharedStateBinding(
  host: ChatPanelSessionGraphHost,
  serverActions: ChatPanelConnectionBundle["serverActions"],
): ChatPanelSharedStateBinding {
  const unsubscribers: (() => void)[] = [];

  const receiveThreads = (threads: readonly Thread[]): void => {
    serverActions.threads.applyThreadList(threads);
    refreshTabHeader(host);
  };
  const receiveThreadResult = (result: AppServerObservedQueryResult<readonly Thread[]>): void => {
    if (result.data) receiveThreads(result.data);
  };
  const receiveAppServerMetadata = (metadata: SharedServerMetadata): void => {
    serverActions.metadata.applyAppServerMetadata(metadata);
  };
  const receiveAppServerMetadataResult = (result: AppServerObservedQueryResult<SharedServerMetadata>): void => {
    if (result.data) receiveAppServerMetadata(result.data);
  };
  const receiveModels = (models: readonly ModelMetadata[]): void => {
    dispatch(host.stateStore, { type: "connection/metadata-applied", availableModels: models });
  };
  const receiveModelsResult = (result: AppServerObservedQueryResult<readonly ModelMetadata[]>): void => {
    if (result.data) receiveModels(result.data);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = host.environment.plugin.threadCatalog.snapshot();
    if (threads) serverActions.threads.applyThreadList(threads);
    const metadata = host.environment.plugin.appServerData.appServerMetadataSnapshot();
    if (metadata) serverActions.metadata.applyAppServerMetadata(metadata);
    const models = host.environment.plugin.appServerData.modelsSnapshot();
    if (models) receiveModels(models);
  };

  return {
    applyCached,
    subscribe: () => {
      unsubscribe();
      applyCached();
      unsubscribers.push(
        host.environment.plugin.threadCatalog.observe(receiveThreadResult, { emitCurrent: false }),
        host.environment.plugin.appServerData.observeAppServerMetadataResult(receiveAppServerMetadataResult, { emitCurrent: false }),
        host.environment.plugin.appServerData.observeModelsResult(receiveModelsResult, { emitCurrent: false }),
      );
    },
    unsubscribe,
  };
}

function createSessionThreadTitleService(host: ChatPanelSessionGraphHost, currentClient: CurrentAppServerClient): ThreadTitleService {
  const { environment, stateStore } = host;
  return createThreadTitleService({
    codexPath: () => environment.plugin.settingsRef.settings.codexPath,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    threadNamingModel: () => environment.plugin.settingsRef.settings.threadNamingModel,
    threadNamingEffort: () => environment.plugin.settingsRef.settings.threadNamingEffort,
    clientAccess: createCurrentClientAccess(currentClient),
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(stateStore.getState().messageStream)),
  });
}

function createSessionAutoTitleController(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  titleService: ThreadTitleService,
): AutoTitleController {
  return new AutoTitleController({
    stateStore: host.stateStore,
    completedTurnTitleContext: (turnId, completedSummary) => titleService.completedTurnContext(turnId, completedSummary),
    generateTitleFromContext: (context) => titleService.generate(context),
    renameGeneratedTitle: async (threadId, title, options) => {
      const name = normalizeExplicitThreadName(title);
      if (!name) return false;
      const client = currentClient();
      if (!client) return false;

      await client.setThreadName(threadId, name);
      if (currentClient() !== client) return false;
      if (options.shouldPublish()) {
        host.environment.plugin.threadCatalog.recordThreadRenamed(threadId, name);
      }
      return true;
    },
  });
}

function createSessionHistoryController(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  status: ChatPanelSessionStatus,
  autoTitle: AutoTitleController,
): HistoryController {
  return new HistoryController({
    stateStore: host.stateStore,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    keepCurrentScrollPosition: () => {
      host.messageScrollIntent.preservePosition();
    },
    showLatestPageAtBottom: () => {
      host.messageScrollIntent.forceBottom();
    },
    setThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  });
}

function createSessionGoalSyncActions(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  status: ChatPanelSessionStatus,
): ChatPanelGoalSyncActions {
  return createThreadGoalSyncActions({
    stateStore: host.stateStore,
    currentClient,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      host.stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState: () => {
      refreshLiveState(host);
    },
  });
}

function createSessionThreadOperations(environment: ChatPanelEnvironment, currentClient: CurrentAppServerClient): ThreadOperations {
  return createThreadOperations({
    clientAccess: createCurrentClientAccess(currentClient),
    archiveExport: {
      settings: () => archiveExportSettings(environment.plugin.settingsRef.settings),
      enabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled,
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    archiveAdapter: environment.obsidian.archiveAdapter,
    catalog: environment.plugin.threadCatalog,
    notice: (text) => {
      new Notice(text);
    },
  });
}

function createCurrentClientAccess(currentClient: CurrentAppServerClient): AppServerClientAccess {
  return {
    withClient: async (operation) => {
      const client = currentClient();
      if (!client) throw new Error("Codex app-server is not connected.");
      const result = await operation(client);
      if (currentClient() !== client) {
        throw new Error("Codex app-server connection changed while running the operation.");
      }
      return result;
    },
  };
}

function createSessionRuntimeSettingsActions(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  status: ChatPanelSessionStatus,
): ChatPanelRuntimeSettingsActions {
  return createChatRuntimeSettingsActions({
    stateStore: host.stateStore,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    collaborationModeLabel: () => collaborationModeLabel(host.stateStore),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  });
}

function createSessionGoalActions(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  ensureConnected: () => Promise<void>,
  status: ChatPanelSessionStatus,
): ChatPanelGoalActions {
  return createGoalActions({
    stateStore: host.stateStore,
    currentClient,
    ensureConnected,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      host.stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState: () => {
      refreshLiveState(host);
    },
  });
}

function createSessionThreadRenameEditor(
  stateStore: ChatStateStore,
  operations: ThreadOperations,
  titleService: ThreadTitleService,
  ensureConnected: () => Promise<void>,
  status: ChatPanelSessionStatus,
): ThreadRenameEditorControllerInstance {
  return new ThreadRenameEditorController({
    stateStore,
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value, options) => operations.renameThread(threadId, value, options),
    generateThreadTitle: (threadId) => titleService.generateTitle(threadId),
  });
}

function createSessionThreadLifecycle(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  ensureConnected: () => Promise<void>,
  status: ChatPanelSessionStatus,
  goals: ChatPanelGoalActions,
  autoTitle: AutoTitleController,
  history: HistoryController,
  invalidateThreadWork: () => void,
): ChatPanelThreadLifecycle {
  return createThreadLifecycleParts({
    settingsRef: host.environment.plugin.settingsRef,
    stateStore: host.stateStore,
    client: {
      currentClient,
      ensureConnected,
    },
    lifecycle: {
      deferredTasks: host.deferredTasks,
      resumeWork: host.resumeWork,
      history,
      invalidateThreadWork,
      getOpened: host.getOpened,
      getClosing: host.getClosing,
    },
    thread: {
      notifyIdentityChanged: () => {
        notifyActiveThreadIdentityChanged(host);
      },
      refreshTabHeader: () => {
        refreshTabHeader(host);
      },
    },
    status,
    liveState: {
      refresh: () => {
        refreshLiveState(host);
      },
    },
    goals,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  });
}

function createSessionComposerSurface(
  threadLifecycle: ChatPanelThreadLifecycle,
  runtimeSettings: ChatPanelRuntimeSettingsActions,
): ChatPanelComposerSurface {
  return {
    thread: {
      restoredPlaceholder: () => threadLifecycle.restoration.placeholder(),
    },
    runtime: {
      requestModel: (model) => runtimeSettings.requestModelFromUi(model),
      requestReasoningEffort: (effort) => runtimeSettings.requestReasoningEffortFromUi(effort),
    },
  };
}

function createSessionComposerController(
  host: ChatPanelSessionGraphHost,
  composerSurface: ChatPanelComposerSurface,
  runtimeSettings: ChatPanelRuntimeSettingsActions,
  messageStreamScrollBridge: MessageStreamScrollBridge,
): ChatComposerController {
  const { environment, stateStore } = host;
  return new ChatComposerController({
    noteCandidateProvider: new VaultNoteCandidateProvider(environment.obsidian.app),
    sourcePath: () => environment.obsidian.app.workspace.getActiveFile()?.path ?? "",
    stateStore,
    viewId: environment.obsidian.viewId,
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => environment.plugin.settingsRef.settings.scrollThreadFromComposerEdges,
    canInterrupt: (state) => {
      return state.turn.lifecycle.kind !== "idle" && Boolean(state.activeThread.id && activeTurnId(state));
    },
    composerProjection: (state) => chatPanelComposerProjection(composerSurface, state),
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      return currentModel(runtimeSnapshotForChatState(current), runtimeConfigOrDefault(current.connection.runtimeConfig));
    },
    threadScrollFromComposer: (action) => {
      messageStreamScrollBridge.scrollFromComposer(action);
    },
    togglePlan: () => void runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
    toggleFast: () => void runtimeSettings.toggleFastMode(),
    onDraftChange: () => {
      refreshLiveState(host);
    },
    onHeightChange: () => {
      messageStreamScrollBridge.repinMessageStreamToBottomIfPinned();
    },
  });
}

function createThreadActionParts(
  host: ChatPanelSessionGraphHost,
  input: {
    operations: ThreadOperations;
    ensureConnected: () => Promise<void>;
    currentClient: CurrentAppServerClient;
    status: ChatPanelSessionStatus;
    composerController: ChatComposerController;
    resume: ResumeController;
    refreshActiveThreads: () => Promise<void>;
  },
): ChatPanelThreadActionParts {
  const { operations, ensureConnected, currentClient, status, composerController, resume, refreshActiveThreads } = input;
  const { environment, stateStore } = host;
  const threadManagementHost: ThreadManagementActionsHost = {
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    operations,
    ensureConnected,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: (text) => {
      composerController.setDraft(text, { focus: true });
    },
    openThreadInNewView: (threadId) => environment.plugin.workspace.openThreadInNewView(threadId),
    openThreadInCurrentPanel: (threadId) => resume.resumeThread(threadId),
    notifyActiveThreadIdentityChanged: () => {
      notifyActiveThreadIdentityChanged(host);
    },
    refreshAfterThreadMutation: async () => {
      await refreshActiveThreads();
    },
    recordForkedThread: (thread) => {
      environment.plugin.threadCatalog.upsertFromAppServer(thread);
    },
  };
  const actions = createThreadManagementActions(threadManagementHost);
  const toolbarPanels = createToolbarPanelActions({
    stateStore,
    threadActions: actions,
  });
  const selection = createSelectionActions({
    stateStore,
    closeForThreadSelection: () => {
      toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => environment.plugin.workspace.focusThreadInOpenView(threadId),
    resumeThread: (threadId) => resume.resumeThread(threadId),
    addSystemMessage: status.addSystemMessage,
  });
  return { actions, toolbarPanels, selection };
}

function createComposerAndTurnActions(
  host: ChatPanelSessionGraphHost,
  input: {
    connection: ConnectionManager;
    ensureConnected: () => Promise<void>;
    currentClient: CurrentAppServerClient;
    status: ChatPanelSessionStatus;
    inboundController: ChatInboundController;
    threadLifecycle: ChatPanelThreadLifecycle;
    threadActions: ChatPanelThreadActions;
    selection: ChatPanelSelectionActions;
    composerController: ChatComposerController;
    runtimeSettings: ChatPanelRuntimeSettingsActions;
    serverThreads: ChatServerThreadActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
    goals: ChatPanelGoalActions;
    autoTitle: AutoTitleController;
    invalidateThreadWork: () => void;
    startNewThread: () => Promise<void>;
    runtimeProjection: {
      connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
      modelStatusLines: () => string[];
      effortStatusLines: () => string[];
      statusSummaryLines: () => string[];
    };
  },
): ChatPanelComposerAndTurnParts {
  const {
    connection,
    ensureConnected,
    currentClient,
    status,
    inboundController,
    threadLifecycle,
    threadActions,
    selection,
    composerController,
    runtimeSettings,
    serverThreads,
    serverDiagnostics,
    goals,
    autoTitle,
    invalidateThreadWork,
    startNewThread,
    runtimeProjection,
  } = input;
  const pendingRequests = new PendingRequestController({
    stateStore: host.stateStore,
    responder: inboundController,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: () => {
      refreshLiveState(host);
    },
  });
  const reconnectHost: ChatReconnectActionsHost = {
    stateStore: host.stateStore,
    invalidateConnectionWork: () => {
      host.connectionWork.invalidate();
    },
    invalidateThreadWork: () => {
      invalidateThreadWork();
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
  };
  const reconnect = () => reconnectPanel(reconnectHost);
  const turnActions = createConversationTurnActions(
    {
      vaultPath: host.environment.plugin.settingsRef.vaultPath,
      stateStore: host.stateStore,
      client: {
        currentClient,
        ensureConnected,
      },
      status,
      runtime: {
        connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
        modelStatusLines: runtimeProjection.modelStatusLines,
        effortStatusLines: runtimeProjection.effortStatusLines,
        statusSummaryLines: runtimeProjection.statusSummaryLines,
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: () =>
          threadLifecycle.restoration.ensureLoaded((threadId) => threadLifecycle.resume.resumeThread(threadId)),
        startNewThread,
        selectThread: (threadId) => selection.selectThread(threadId),
        notifyIdentityChanged: () => {
          notifyActiveThreadIdentityChanged(host);
        },
        resetTurnPresence: (hadTurns) => {
          autoTitle.resetThreadTurnPresence(hadTurns);
        },
      },
      composer: {
        codexInput: (text) => composerController.codexInput(text),
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: (text, options) => {
          composerController.setDraft(text, options);
        },
      },
      scroll: {
        followBottom: () => {
          host.messageScrollIntent.followBottom();
        },
      },
    },
    {
      threadStarter: serverThreads,
      runtimeSettings,
      threadActions,
      reconnectPanel: reconnect,
      goals,
    },
  );

  return {
    pendingRequests,
    reconnect,
    turnActions,
  };
}

function createSurfacesAndPresenter(
  host: ChatPanelSessionGraphHost,
  input: {
    connection: ConnectionManager;
    connectionController: ChatPanelConnectionBundle["connection"]["controller"];
    inboundController: ChatInboundController;
    serverThreads: ChatServerThreadActions;
    goals: ChatPanelGoalActions;
    rename: ThreadRenameEditorControllerInstance;
    threadActions: ChatPanelThreadActions;
    toolbarPanels: ToolbarPanelActions;
    selection: ChatPanelSelectionActions;
    reconnect: () => Promise<void>;
    history: HistoryController;
    pendingRequests: PendingRequestController;
    turnActions: ChatPanelConversationTurnActions;
    messageStreamScrollBridge: MessageStreamScrollBridge;
    startNewThread: () => Promise<void>;
  },
): ChatPanelSurfacePresenterParts {
  const {
    connection,
    connectionController,
    inboundController,
    serverThreads,
    goals,
    rename,
    threadActions,
    toolbarPanels,
    selection,
    reconnect,
    history,
    pendingRequests,
    turnActions,
    messageStreamScrollBridge,
    startNewThread,
  } = input;
  const { environment, stateStore } = host;
  const toolbarActions = createChatPanelToolbarActions(
    {
      stateStore,
      startNewThread,
    },
    {
      connectionController,
      reconnectPanel: reconnect,
      inboundController,
      threadActions,
      toolbarPanels,
      rename,
      selection,
    },
  );
  const toolbarSurface: ChatPanelToolbarSurface = {
    state: {
      connected: () => connection.isConnected(),
      nowMs: () => Date.now(),
    },
    settings: {
      vaultPath: () => environment.plugin.settingsRef.vaultPath,
      configuredCommand: () => environment.plugin.settingsRef.settings.codexPath,
      archiveExportEnabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled,
    },
  };
  const goalSurface = createChatPanelGoalSurface(
    {
      sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut,
      stateStore,
    },
    {
      connectionController,
      inboundController,
      threadStarter: serverThreads,
      goals,
    },
  );
  const messageStreamPresenter = new MessageStreamPresenter({
    obsidian: {
      app: environment.obsidian.app,
      owner: environment.obsidian.owner,
    },
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    scroll: {
      consumeIntent: () => host.messageScrollIntent.consumeIntent(),
      registerVirtualizer: messageStreamScrollBridge.registerVirtualizer,
      dispose: () => {
        messageStreamScrollBridge.dispose();
      },
    },
    history: {
      loadOlderTurns: () => void history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turnActions.planImplementation.implement(itemId),
      openTurnDiff: (state) => void environment.plugin.workspace.openTurnDiff(state),
    },
    requests: {
      pendingSignature: () => {
        const state = stateStore.getState();
        return pendingRequestsSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
      },
      pendingSnapshot: () => pendingRequests.snapshot(),
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });

  return {
    toolbarActions,
    toolbarSurface,
    goalSurface,
    messageStreamPresenter,
  };
}

function collaborationModeLabel(stateStore: ChatStateStore): string {
  return formatCollaborationModeLabel(stateStore.getState().runtime.selectedCollaborationMode);
}

function createSessionStatus(stateStore: ChatStateStore, localItemIds: LocalChatItemIdFactory): ChatPanelSessionStatus {
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

function notifyActiveThreadIdentityChanged(host: ChatPanelSessionGraphHost): void {
  refreshTabHeader(host);
  host.environment.obsidian.requestWorkspaceLayoutSave();
}

function refreshTabHeader(host: ChatPanelSessionGraphHost): void {
  host.environment.view.refreshTabHeader();
}

function refreshLiveState(host: ChatPanelSessionGraphHost): void {
  host.environment.plugin.workspace.refreshThreadsViewLiveState();
}

function deferLiveStateRefresh(host: ChatPanelSessionGraphHost): void {
  host.viewWindow().setTimeout(() => {
    refreshLiveState(host);
  }, 0);
}

function statusSummaryLines(host: ChatPanelSessionGraphHost): string[] {
  const state = host.stateStore.getState();
  return buildStatusSummaryLines({
    activeThreadId: state.activeThread.id,
    snapshot: runtimeSnapshot(host),
    nowMs: Date.now(),
  });
}

function modelStatusLines(host: ChatPanelSessionGraphHost): string[] {
  const state = host.stateStore.getState();
  return buildModelStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    requestedModel: state.runtime.requestedModel,
    snapshot: runtimeSnapshot(host),
    collaborationModeLabel: collaborationModeLabel(host.stateStore),
  });
}

function effortStatusLines(host: ChatPanelSessionGraphHost): string[] {
  const state = host.stateStore.getState();
  return buildEffortStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    requestedReasoningEffort: state.runtime.requestedReasoningEffort,
    snapshot: runtimeSnapshot(host),
  });
}

function connectionDiagnosticDetails(host: ChatPanelSessionGraphHost, connection: ConnectionManager): MessageStreamNoticeSection[] {
  return connectionDiagnosticsModel({
    state: host.stateStore.getState(),
    connected: connection.isConnected(),
    configuredCommand: host.environment.plugin.settingsRef.settings.codexPath,
  }).map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function runtimeSnapshot(host: ChatPanelSessionGraphHost): RuntimeSnapshot {
  return runtimeSnapshotForChatState(host.stateStore.getState());
}
