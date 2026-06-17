import { Notice } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
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
import { activeTurnId, type ChatConnectionPhase } from "../application/state/root-reducer";
import { messageStreamItems } from "../application/state/message-stream";
import type { ChatStateStore } from "../application/state/store";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../application/lifecycle";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import { AutoTitleController } from "../application/threads/auto-title-controller";
import type { HistoryController } from "../application/threads/history-controller";
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
import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import type { ChatPanelEnvironment } from "./runtime";
import { createConnectionBundle, type ChatPanelConnectionBundle, type CurrentAppServerClient } from "./connection-bundle";

export interface ChatPanelSessionParts {
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
}

export interface ChatPanelSessionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

interface ChatPanelSessionPartsHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  connectionWork: ConnectionWorkTracker;
  messageScrollIntent: ChatMessageScrollIntentState;
  getOpened: () => boolean;
  getClosing: () => boolean;
  invalidateResumeWork: () => void;
  loadSharedThreadList: () => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  deferLiveStateRefresh: () => void;
  startNewThread: () => Promise<void>;
  statusSummaryLines: () => string[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
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

export function createChatPanelSessionParts(host: ChatPanelSessionPartsHost, status: ChatPanelSessionStatus): ChatPanelSessionParts {
  const { environment, stateStore } = host;
  const connection = createConnectionManager(environment);
  const currentClient = () => connection.currentClient();
  const titleService = createSessionThreadTitleService(host, currentClient);
  const autoTitle = createSessionAutoTitleController(host, currentClient, titleService);
  const goalSync = createSessionGoalSyncActions(host, currentClient, status);
  const serverParts = createConnectionBundle(host, {
    connection,
    currentClient,
    goalSync,
    autoTitle,
    status,
  });
  const {
    connection: { controller },
    inboundController,
  } = serverParts;
  const connectionController = controller;
  const { threads: serverThreads, diagnostics: serverDiagnostics } = serverParts.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const refreshActiveThreads = () => connectionController.refreshActiveThreads();
  const threadOperations = createSessionThreadOperations(environment, currentClient, ensureConnected);
  const runtimeSettings = createSessionRuntimeSettingsActions(host, currentClient, status);
  const goals = createSessionGoalActions(host, currentClient, ensureConnected, status);
  const rename = createSessionThreadRenameEditor(stateStore, threadOperations, titleService, ensureConnected, status);
  const threadLifecycle = createSessionThreadLifecycle(host, currentClient, ensureConnected, status, goals, autoTitle);
  const { history, identity, restoration, resume } = threadLifecycle;

  const composerSurface = createSessionComposerSurface(threadLifecycle, runtimeSettings);
  const messageStreamScrollBridge = new MessageStreamScrollBridge();
  const composerController = createSessionComposerController(host, composerSurface, runtimeSettings, messageStreamScrollBridge);
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
  });

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
  };
}

function createConnectionManager(environment: ChatPanelEnvironment): ConnectionManager {
  return new ConnectionManager(() => environment.plugin.settingsRef.settings.codexPath, environment.plugin.settingsRef.vaultPath);
}

function createSessionThreadTitleService(host: ChatPanelSessionPartsHost, currentClient: CurrentAppServerClient): ThreadTitleService {
  const { environment, stateStore } = host;
  return createThreadTitleService({
    settings: {
      current: () => environment.plugin.settingsRef.settings,
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    currentClient,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(stateStore.getState().messageStream)),
  });
}

function createSessionAutoTitleController(
  host: ChatPanelSessionPartsHost,
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

function createSessionGoalSyncActions(
  host: ChatPanelSessionPartsHost,
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
      host.refreshLiveState();
    },
  });
}

function createSessionThreadOperations(
  environment: ChatPanelEnvironment,
  currentClient: CurrentAppServerClient,
  ensureConnected: () => Promise<void>,
): ThreadOperations {
  return createThreadOperations({
    connection: {
      ensureConnected,
      currentClient,
    },
    settings: {
      current: () => environment.plugin.settingsRef.settings,
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    archiveAdapter: environment.obsidian.archiveAdapter,
    catalog: environment.plugin.threadCatalog,
    notice: (text) => {
      new Notice(text);
    },
  });
}

function createSessionRuntimeSettingsActions(
  host: ChatPanelSessionPartsHost,
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
  host: ChatPanelSessionPartsHost,
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
      host.refreshLiveState();
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
  host: ChatPanelSessionPartsHost,
  currentClient: CurrentAppServerClient,
  ensureConnected: () => Promise<void>,
  status: ChatPanelSessionStatus,
  goals: ChatPanelGoalActions,
  autoTitle: AutoTitleController,
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
      getOpened: host.getOpened,
      getClosing: host.getClosing,
    },
    thread: {
      notifyIdentityChanged: () => {
        host.notifyActiveThreadIdentityChanged();
      },
      refreshTabHeader: () => {
        host.refreshTabHeader();
      },
    },
    status,
    liveState: {
      refresh: () => {
        host.refreshLiveState();
      },
    },
    scroll: {
      preservePosition: () => {
        host.messageScrollIntent.preservePosition();
      },
      forceBottom: () => {
        host.messageScrollIntent.forceBottom();
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
  host: ChatPanelSessionPartsHost,
  composerSurface: ChatPanelComposerSurface,
  runtimeSettings: ChatPanelRuntimeSettingsActions,
  messageStreamScrollBridge: MessageStreamScrollBridge,
): ChatComposerController {
  const { environment, stateStore } = host;
  return new ChatComposerController({
    app: environment.obsidian.app,
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
      host.refreshLiveState();
    },
    onHeightChange: () => {
      messageStreamScrollBridge.repinMessageStreamToBottomIfPinned();
    },
  });
}

function createThreadActionParts(
  host: ChatPanelSessionPartsHost,
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
      host.notifyActiveThreadIdentityChanged();
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
  host: ChatPanelSessionPartsHost,
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
  } = input;
  const pendingRequests = new PendingRequestController({
    stateStore: host.stateStore,
    responder: inboundController,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: () => {
      host.refreshLiveState();
    },
  });
  const reconnectHost: ChatReconnectActionsHost = {
    stateStore: host.stateStore,
    invalidateConnectionWork: () => {
      host.connectionWork.invalidate();
    },
    invalidateResumeWork: () => {
      host.invalidateResumeWork();
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
        connectionDiagnosticDetails: () => host.connectionDiagnosticDetails(),
        modelStatusLines: () => host.modelStatusLines(),
        effortStatusLines: () => host.effortStatusLines(),
        statusSummaryLines: () => host.statusSummaryLines(),
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: () =>
          threadLifecycle.restoration.ensureLoaded((threadId) => threadLifecycle.resume.resumeThread(threadId)),
        startNewThread: () => host.startNewThread(),
        selectThread: (threadId) => selection.selectThread(threadId),
        notifyIdentityChanged: () => {
          host.notifyActiveThreadIdentityChanged();
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
  host: ChatPanelSessionPartsHost,
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
  } = input;
  const { environment, stateStore } = host;
  const toolbarActions = createChatPanelToolbarActions(
    {
      stateStore,
      startNewThread: () => host.startNewThread(),
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
      settings: environment.plugin.settingsRef.settings,
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
      implementPlan: (item: MessageStreamItem) => void turnActions.planImplementation.implement(item),
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
