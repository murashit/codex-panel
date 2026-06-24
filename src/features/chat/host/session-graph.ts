import { Notice } from "obsidian";
import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { ObservedDataResult } from "../../../domain/observed-data";
import { observedData } from "../../../domain/observed-data";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import { normalizeExplicitThreadName, type Thread } from "../../../domain/threads/model";
import { createLocalIdSource, type LocalIdSource } from "../../../shared/id/local-id";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { createThreadOperations, type ThreadOperations } from "../../threads/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../../threads/thread-title-service";
import type { ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import type { ChatServerMetadataActions } from "../app-server/actions/metadata";
import type { ChatServerThreadActions } from "../app-server/actions/threads";
import type { ChatInboundHandler } from "../app-server/inbound/handler";
import { connectionDiagnosticSectionsModel } from "../application/connection/diagnostics-display";
import { type ChatReconnectActionsHost, reconnectPanel } from "../application/connection/reconnect-actions";
import { toolInventoryDiagnosticSections } from "../application/connection/tool-inventory-display";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import {
  type ConversationTurnActions as ChatPanelConversationTurnActions,
  createConversationTurnActions,
} from "../application/conversation/composition";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../application/lifecycle";
import { createPendingRequestActions, type PendingRequestActions } from "../application/pending-requests/pending-request-actions";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { messageStreamItems } from "../application/state/message-stream";
import type { ChatAction, ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../application/threads/auto-title-coordinator";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import { HistoryController } from "../application/threads/history-controller";
import { createThreadLifecycleParts } from "../application/threads/lifecycle-parts";
import {
  activeThreadRenameTitleContext,
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
} from "../application/threads/rename-editor-actions";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeActions } from "../application/threads/resume-actions";
import { createSelectionActions } from "../application/threads/selection-actions";
import { createStartNewThreadActions } from "../application/threads/start-new-thread-actions";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "../application/threads/thread-management-actions";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../domain/runtime/labels";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import { ChatComposerController } from "../panel/composer-controller";
import { type ChatPanelComposerSurface, chatPanelComposerProjection } from "../panel/surface/composer-projection";
import { type ChatPanelGoalSurface, createChatPanelGoalSurface } from "../panel/surface/goal-projection";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import type { ChatMessageScrollController } from "../panel/surface/message-stream-scroll";
import type { ChatPanelToolbarSurface } from "../panel/surface/toolbar-projection";
import { createChatPanelToolbarActions, createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import { VaultNoteCandidateProvider } from "../panel/vault-note-candidate-provider";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import type { ToolbarActions } from "../ui/toolbar";
import { type ChatPanelConnectionBundle, type CurrentAppServerClient, createConnectionBundle } from "./connection-bundle";
import type { ChatPanelEnvironment } from "./runtime";

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
    resume: ResumeActions;
    restoration: RestorationController;
    identity: ActiveThreadIdentitySync;
    rename: ThreadRenameEditorActions;
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
  messageScrollController: ChatMessageScrollController;
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
  pendingRequests: PendingRequestActions;
  reconnect: () => Promise<void>;
  turnActions: ChatPanelConversationTurnActions;
}

interface ChatPanelRuntimeProjection {
  connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  toolInventoryDetails: () => MessageStreamNoticeSection[];
}

interface ChatPanelComposerAndTurnInput {
  connection: ConnectionManager;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  connectedClient: () => Promise<ReturnType<CurrentAppServerClient>>;
  currentClient: CurrentAppServerClient;
  status: ChatPanelSessionStatus;
  inboundHandler: ChatInboundHandler;
  threadLifecycle: ChatPanelThreadLifecycle;
  threadActions: ChatPanelThreadActions;
  selection: ChatPanelSelectionActions;
  composerController: ChatComposerController;
  runtimeSettings: ChatPanelRuntimeSettingsActions;
  serverThreads: ChatServerThreadActions;
  goals: ChatPanelGoalActions;
  autoTitleCoordinator: AutoTitleCoordinator;
  invalidateThreadWork: () => void;
  startNewThread: () => Promise<void>;
  runtimeProjection: ChatPanelRuntimeProjection;
}

interface ChatPanelSurfacePresenterInput {
  connection: ConnectionManager;
  connectionController: ChatPanelConnectionBundle["connection"]["controller"];
  goals: ChatPanelGoalActions;
  rename: ThreadRenameEditorActions;
  threadActions: ChatPanelThreadActions;
  toolbarPanels: ToolbarPanelActions;
  selection: ChatPanelSelectionActions;
  reconnect: () => Promise<void>;
  history: HistoryController;
  pendingRequests: PendingRequestActions;
  turnActions: ChatPanelConversationTurnActions;
  startNewThread: () => Promise<void>;
}

interface ChatPanelSurfacePresenterParts {
  toolbarActions: ToolbarActions;
  toolbarSurface: ChatPanelToolbarSurface;
  goalSurface: ChatPanelGoalSurface;
  messageStreamPresenter: MessageStreamPresenter;
}

export function createChatPanelSessionGraph(host: ChatPanelSessionGraphHost): ChatPanelSessionGraph {
  const { environment, stateStore } = host;
  const localItemIds = createLocalIdSource();
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  const status = createSessionStatus(stateStore, localItemIds);
  const titleService = createSessionThreadTitleService(host, currentClient);
  const autoTitleCoordinator = createSessionAutoTitleCoordinator(host, currentClient, titleService);
  const history = createSessionHistoryController(host, currentClient, status, autoTitleCoordinator);
  const invalidateThreadWork = () => {
    host.resumeWork.invalidate();
    history.invalidate();
  };
  const goalSync = createSessionGoalSyncActions(host, currentClient, localItemIds, status);
  const connectionBundle = createConnectionBundle(
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
      localItemIds,
      goalSync,
      autoTitleCoordinator,
      status,
    },
  );
  const {
    connection: { controller },
    inboundHandler,
  } = connectionBundle;
  const connectionController = controller;
  const { threads: serverThreads } = connectionBundle.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const connectedClient = async () => {
    await ensureConnected();
    return currentClient();
  };
  const refreshActiveThreads = () => connectionController.refreshActiveThreads();
  const threadOperations = createSessionThreadOperations(environment, currentClient);
  const runtimeSettings = createSessionRuntimeSettingsActions(host, currentClient, status);
  const goals = createSessionGoalActions(host, currentClient, localItemIds, connectedClient, status, serverThreads);
  const rename = createSessionThreadRenameEditorActions(stateStore, threadOperations, titleService, ensureConnected, status);
  const threadLifecycle = createSessionThreadLifecycle(
    host,
    currentClient,
    ensureConnected,
    status,
    goals,
    autoTitleCoordinator,
    history,
    invalidateThreadWork,
  );
  const { identity, restoration, resume } = threadLifecycle;

  const composerSurface = createSessionComposerSurface(threadLifecycle, runtimeSettings);
  const composerController = createSessionComposerController(host, composerSurface, runtimeSettings);
  const newThreadActions = createStartNewThreadActions({
    stateStore,
    identity,
    focusComposer: () => {
      composerController.focus();
    },
  });
  const startNewThread = () => newThreadActions.startNewThread();
  const threadActionParts = createThreadActionParts(host, {
    operations: threadOperations,
    connectedClient,
    currentClient,
    status,
    composerController,
    resume,
    refreshActiveThreads,
  });
  const composerAndTurn = createComposerAndTurnActions(host, {
    connection,
    localItemIds,
    ensureConnected,
    connectedClient,
    currentClient,
    status,
    inboundHandler,
    threadLifecycle,
    threadActions: threadActionParts.actions,
    selection: threadActionParts.selection,
    composerController,
    runtimeSettings,
    serverThreads,
    goals,
    autoTitleCoordinator,
    invalidateThreadWork,
    startNewThread,
    runtimeProjection: createSessionRuntimeProjection(host, connection),
  });
  const surfaceParts = createSurfacesAndPresenter(host, {
    connection,
    connectionController,
    goals,
    rename,
    threadActions: threadActionParts.actions,
    toolbarPanels: threadActionParts.toolbarPanels,
    selection: threadActionParts.selection,
    reconnect: composerAndTurn.reconnect,
    history,
    pendingRequests: composerAndTurn.pendingRequests,
    turnActions: composerAndTurn.turnActions,
    startNewThread,
  });
  const refreshSharedThreads = async (): Promise<void> => {
    try {
      await connectionBundle.refreshSharedThreads();
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      throw error;
    }
  };
  const dispose = (): void => {
    surfaceParts.messageStreamPresenter.dispose();
    composerController.dispose();
  };
  const sharedState = createChatPanelSharedStateBinding(host, connectionBundle.serverActions);

  return {
    connection: {
      manager: connection,
      controller: connectionController,
    },
    serverActions: connectionBundle.serverActions,
    thread: {
      history,
      resume,
      restoration,
      identity,
      rename,
    },
    toolbar: {
      panels: threadActionParts.toolbarPanels,
      actions: surfaceParts.toolbarActions,
    },
    composer: {
      controller: composerController,
      submission: composerAndTurn.turnActions.composerSubmit,
    },
    render: {
      messageStreamPresenter: surfaceParts.messageStreamPresenter,
    },
    surface: {
      toolbar: surfaceParts.toolbarSurface,
      goal: surfaceParts.goalSurface,
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
  const receiveThreadResult = (result: ObservedDataResult<readonly Thread[]>): void => {
    const data = observedData(result);
    if (data) receiveThreads(data);
  };
  const receiveAppServerMetadata = (metadata: SharedServerMetadata): void => {
    serverActions.metadata.applyAppServerMetadata(metadata);
  };
  const receiveAppServerMetadataResult = (result: ObservedDataResult<SharedServerMetadata>): void => {
    const data = observedData(result);
    if (data) receiveAppServerMetadata(data);
  };
  const receiveModels = (models: readonly ModelMetadata[]): void => {
    dispatch(host.stateStore, { type: "connection/metadata-applied", availableModels: models });
  };
  const receiveModelsResult = (result: ObservedDataResult<readonly ModelMetadata[]>): void => {
    const data = observedData(result);
    if (data) receiveModels(data);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = host.environment.plugin.threadCatalog.activeSnapshot();
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
        host.environment.plugin.threadCatalog.observeActive(receiveThreadResult, { emitCurrent: false }),
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

function createSessionAutoTitleCoordinator(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  titleService: ThreadTitleService,
): AutoTitleCoordinator {
  return createAutoTitleCoordinator({
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
        host.environment.plugin.threadCatalog.apply({ type: "thread-renamed", threadId, name });
      }
      return true;
    },
  });
}

function createSessionHistoryController(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  status: ChatPanelSessionStatus,
  autoTitleCoordinator: AutoTitleCoordinator,
): HistoryController {
  return new HistoryController({
    stateStore: host.stateStore,
    currentClient,
    addSystemMessage: status.addSystemMessage,
    showLatestPageAtBottom: () => {
      host.messageScrollController.showLatest();
    },
    setThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  });
}

function createSessionGoalSyncActions(
  host: ChatPanelSessionGraphHost,
  currentClient: CurrentAppServerClient,
  localItemIds: LocalIdSource,
  status: ChatPanelSessionStatus,
): ChatPanelGoalSyncActions {
  return createThreadGoalSyncActions({
    stateStore: host.stateStore,
    currentClient,
    localItemIds,
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
      settings: () => ({
        archiveExportFolderTemplate: environment.plugin.settingsRef.settings.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: environment.plugin.settingsRef.settings.archiveExportFilenameTemplate,
        archiveExportTags: environment.plugin.settingsRef.settings.archiveExportTags,
      }),
      enabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled,
      vaultPath: environment.plugin.settingsRef.vaultPath,
      vaultConfigDir: environment.obsidian.app.vault.configDir,
    },
    archiveDestination: environment.obsidian.archiveDestination,
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
  localItemIds: LocalIdSource,
  connectedClient: () => Promise<ReturnType<CurrentAppServerClient>>,
  status: ChatPanelSessionStatus,
  serverThreads: ChatServerThreadActions,
): ChatPanelGoalActions {
  return createGoalActions({
    stateStore: host.stateStore,
    currentClient,
    localItemIds,
    connectedClient,
    startThread: (preview, options) => serverThreads.startThread(preview, options),
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

function createSessionThreadRenameEditorActions(
  stateStore: ChatStateStore,
  operations: ThreadOperations,
  titleService: ThreadTitleService,
  ensureConnected: () => Promise<void>,
  status: ChatPanelSessionStatus,
): ThreadRenameEditorActions {
  return createThreadRenameEditorActions({
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
  autoTitleCoordinator: AutoTitleCoordinator,
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
      resumeWork: host.resumeWork,
      history,
      invalidateThreadWork,
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
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
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
      return state.turnBusy && Boolean(state.activeThreadId && state.activeTurnId);
    },
    composerProjection: (state) => chatPanelComposerProjection(composerSurface, state),
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      return currentModel(runtimeSnapshotForChatState(current), runtimeConfigOrDefault(current.connection.runtimeConfig));
    },
    threadScrollFromComposer: (action) => {
      host.messageScrollController.scrollFromComposer(action);
    },
    togglePlan: () => void runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
    toggleFast: () => void runtimeSettings.toggleFastMode(),
    onDraftChange: () => {
      refreshLiveState(host);
    },
    onHeightChange: () => undefined,
  });
}

function createThreadActionParts(
  host: ChatPanelSessionGraphHost,
  input: {
    operations: ThreadOperations;
    connectedClient: () => Promise<ReturnType<CurrentAppServerClient>>;
    currentClient: CurrentAppServerClient;
    status: ChatPanelSessionStatus;
    composerController: ChatComposerController;
    resume: ResumeActions;
    refreshActiveThreads: () => Promise<void>;
  },
): ChatPanelThreadActionParts {
  const { operations, connectedClient, currentClient, status, composerController, resume, refreshActiveThreads } = input;
  const { environment, stateStore } = host;
  const threadManagementHost: ThreadManagementActionsHost = {
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    operations,
    connectedClient,
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
    applyThreadCatalogEvent: (event) => {
      environment.plugin.threadCatalog.apply(event);
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
  input: ChatPanelComposerAndTurnInput,
): ChatPanelComposerAndTurnParts {
  const {
    connection,
    localItemIds,
    ensureConnected,
    connectedClient,
    currentClient,
    status,
    inboundHandler,
    threadLifecycle,
    threadActions,
    selection,
    composerController,
    runtimeSettings,
    serverThreads,
    goals,
    autoTitleCoordinator,
    invalidateThreadWork,
    startNewThread,
    runtimeProjection,
  } = input;
  const pendingRequests = createPendingRequestActions({
    stateStore: host.stateStore,
    responder: inboundHandler,
    composerHasFocus: () => composerController.hasFocus(),
    focusComposer: () => {
      composerController.focus();
    },
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
      localItemIds,
      client: {
        currentClient,
        connectedClient,
      },
      status,
      runtime: {
        connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
        modelStatusLines: runtimeProjection.modelStatusLines,
        effortStatusLines: runtimeProjection.effortStatusLines,
        statusSummaryLines: runtimeProjection.statusSummaryLines,
        toolInventoryDetails: runtimeProjection.toolInventoryDetails,
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
          autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
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
        showLatest: () => {
          host.messageScrollController.showLatest();
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
  input: ChatPanelSurfacePresenterInput,
): ChatPanelSurfacePresenterParts {
  const {
    connection,
    connectionController,
    goals,
    rename,
    threadActions,
    toolbarPanels,
    selection,
    reconnect,
    history,
    pendingRequests,
    turnActions,
    startNewThread,
  } = input;
  const { environment, stateStore } = host;
  const toolbarActions = createChatPanelToolbarActions(
    {
      startNewThread,
    },
    {
      connectionController,
      reconnectPanel: reconnect,
      threadActions,
      goals,
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
    },
    {
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
      controller: host.messageScrollController,
      dispose: () => {
        host.messageScrollController.dispose();
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
  return formatCollaborationModeLabel(stateStore.getState().runtime.pending.collaborationMode);
}

function createSessionRuntimeProjection(host: ChatPanelSessionGraphHost, connection: ConnectionManager): ChatPanelRuntimeProjection {
  return {
    connectionDiagnosticDetails: () => connectionDiagnosticDetails(host, connection),
    modelStatusLines: () => modelStatusLines(host),
    effortStatusLines: () => effortStatusLines(host),
    statusSummaryLines: () => statusSummaryLines(host),
    toolInventoryDetails: () => toolInventoryDetails(host),
  };
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

function notifyActiveThreadIdentityChanged(host: ChatPanelSessionGraphHost): void {
  refreshTabHeader(host);
  host.environment.obsidian.requestWorkspaceLayoutSave();
  refreshLiveState(host);
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
    pendingModel: state.runtime.pending.model,
    snapshot: runtimeSnapshot(host),
    collaborationModeLabel: collaborationModeLabel(host.stateStore),
  });
}

function effortStatusLines(host: ChatPanelSessionGraphHost): string[] {
  const state = host.stateStore.getState();
  return buildEffortStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    pendingReasoningEffort: state.runtime.pending.reasoningEffort,
    snapshot: runtimeSnapshot(host),
  });
}

function connectionDiagnosticDetails(host: ChatPanelSessionGraphHost, connection: ConnectionManager): MessageStreamNoticeSection[] {
  const sections = connectionDiagnosticSectionsModel({
    state: host.stateStore.getState(),
    connected: connection.isConnected(),
    configuredCommand: host.environment.plugin.settingsRef.settings.codexPath,
  });
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function toolInventoryDetails(host: ChatPanelSessionGraphHost): MessageStreamNoticeSection[] {
  const sections = toolInventoryDiagnosticSections(host.stateStore.getState().connection.serverDiagnostics);
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function runtimeSnapshot(host: ChatPanelSessionGraphHost): RuntimeSnapshot {
  return runtimeSnapshotForChatState(host.stateStore.getState());
}
