import { Notice } from "obsidian";

import type { AppServerClient } from "../../../app-server/connection/client";
import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { AppServerObservedQueryResult } from "../../../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import { appServerQueryContextRawEquals, type AppServerQueryContext } from "../../../app-server/query/keys";
import { renameThreadOnAppServer, threadRenameFromValue } from "../../../app-server/services/thread-rename";
import type { ModelMetadata } from "../../../domain/catalog/metadata";

import type { Thread } from "../../../domain/threads/model";
import { getThreadTitle } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { shortThreadId } from "../../../utils";
import { ThreadOperations } from "../../threads/thread-operations";
import { ThreadTitleService } from "../../threads/thread-title-service";
import { PendingRequestController } from "../application/pending-requests/controller";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../domain/local-id";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { createChatViewDeferredTasks } from "./lifecycle";
import { ChatResumeWorkTracker, type ChatViewDeferredTasks } from "../application/lifecycle";
import { ChatConnectionController, handleChatConnectionExit } from "../application/connection/connection-controller";
import { connectionDiagnosticsModel } from "../application/connection/diagnostics-display";
import { reconnectPanel, type ChatReconnectActionsHost } from "../application/connection/reconnect-actions";
import { createConversationTurnActions } from "../application/conversation/composition";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import { openPanelTurnLifecycle, parseRestoredThreadState, type ChatPanelSnapshot } from "../panel/snapshot";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import { runtimeSnapshotForChatState, type RuntimeSnapshot } from "../application/runtime/snapshot";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { activeTurnId, type ChatConnectionPhase, chatTurnBusy, type ChatAction, type ChatState } from "../application/state/root-reducer";
import { messageStreamItems } from "../application/state/message-stream";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll-intent";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell";
import { createChatStateStore, type ChatStateStore } from "../application/state/store";
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
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../app-server/actions/metadata";
import { createChatServerThreadActions, type ChatServerThreadActions } from "../app-server/actions/threads";
import { ChatInboundController } from "../app-server/inbound/controller";
import { rejectServerRequest, respondToServerRequest } from "../app-server/requests/responder";
import { ChatComposerController } from "../panel/composer-controller";
import type { ChatPanelComposerSurface, ChatPanelGoalSurface, ChatPanelToolbarSurface } from "../panel/surface/model";
import { chatPanelComposerProjection } from "../panel/surface/composer-projection";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { MessageStreamScrollBridge } from "../panel/surface/message-stream-scroll";
import { createChatPanelGoalSurface } from "../panel/surface/goal-surface";
import { createChatPanelToolbarActions, createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ToolbarActions } from "../ui/toolbar";
import { pendingRequestsSignature } from "../domain/pending-requests/signatures";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";
import type { ChatSurfaceHandle } from "./surface-handle";
import type { ChatPanelEnvironment } from "./runtime";

function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? getThreadTitle(thread).replace(/\s+/g, " ").trim() : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

interface ChatPanelSessionParts {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
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

interface ChatPanelSessionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

interface ChatPanelConnectionBundle {
  connection: ChatPanelSessionParts["connection"];
  inboundController: ChatInboundController;
  serverActions: ChatPanelSessionParts["serverActions"];
}

type CurrentAppServerClient = () => AppServerClient | null;

type ChatPanelGoalSyncActions = ReturnType<typeof createThreadGoalSyncActions>;
type ChatPanelRuntimeSettingsActions = ReturnType<typeof createChatRuntimeSettingsActions>;
type ChatPanelGoalActions = ReturnType<typeof createGoalActions>;
type ChatPanelThreadLifecycle = ReturnType<typeof createThreadLifecycleParts>;
type ChatPanelThreadActions = ReturnType<typeof createThreadManagementActions>;
type ChatPanelSelectionActions = ReturnType<typeof createSelectionActions>;
type ChatPanelConversationTurnActions = ReturnType<typeof createConversationTurnActions>;

interface ChatPanelConnectionBundleInput {
  connection: ConnectionManager;
  currentClient: CurrentAppServerClient;
  status: ChatPanelSessionStatus;
  goalSync: ChatPanelGoalSyncActions;
  autoTitle: AutoTitleController;
}

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

export class ChatPanelSession implements ChatSurfaceHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly parts: ChatPanelSessionParts;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollIntent: ChatMessageScrollIntentState = createChatMessageScrollIntentState();
  private readonly localItemIds: LocalChatItemIdFactory = createLocalChatItemIdFactory();
  private readonly appServerStateUnsubscribers: (() => void)[] = [];
  private observedAppServerContext: AppServerQueryContext;
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.parts = this.createSessionParts();
  }

  private createSessionParts(): ChatPanelSessionParts {
    const status = this.createSessionStatus();
    const connection = this.createConnectionManager();
    const currentClient = () => connection.currentClient();
    const titleService = this.createThreadTitleService(currentClient);
    const autoTitle = this.createAutoTitleController(currentClient, titleService);
    const goalSync = this.createGoalSyncActions(currentClient, status);
    const serverParts = this.createConnectionBundle({
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
    const fetchActiveThreads = () => connectionController.fetchActiveThreads();
    const threadOperations = this.createThreadOperations(currentClient, ensureConnected);
    const runtimeSettings = this.createRuntimeSettingsActions(currentClient, status);
    const goals = this.createGoalActions(currentClient, ensureConnected, status);
    const rename = this.createThreadRenameEditor(threadOperations, titleService, ensureConnected, status);
    const threadLifecycle = this.createThreadLifecycle(currentClient, ensureConnected, status, goals, autoTitle);
    const { history, identity, restoration, resume } = threadLifecycle;

    const composerSurface = this.createComposerSurface(threadLifecycle, runtimeSettings);
    const messageStreamScrollBridge = new MessageStreamScrollBridge();
    const composerController = this.createComposerController(composerSurface, runtimeSettings, messageStreamScrollBridge);
    const threadActionParts = this.createThreadActionParts({
      operations: threadOperations,
      ensureConnected,
      currentClient,
      status,
      composerController,
      resume,
      fetchActiveThreads,
    });
    const composerAndTurn = this.createComposerAndTurnActions({
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
    const surfaceAndPresenter = this.createSurfacesAndPresenter({
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

  private createConnectionManager(): ConnectionManager {
    return new ConnectionManager(
      () => this.environment.plugin.settingsRef.settings.codexPath,
      this.environment.plugin.settingsRef.vaultPath,
    );
  }

  private createThreadTitleService(currentClient: CurrentAppServerClient): ThreadTitleService {
    const environment = this.environment;
    return new ThreadTitleService({
      settings: {
        current: () => environment.plugin.settingsRef.settings,
        vaultPath: environment.plugin.settingsRef.vaultPath,
      },
      currentClient,
      visibleContext: (threadId) => activeThreadRenameTitleContext(this.state, threadId),
      visibleCompletedTurnContext: (turnId) =>
        threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(this.state.messageStream)),
    });
  }

  private createAutoTitleController(currentClient: CurrentAppServerClient, titleService: ThreadTitleService): AutoTitleController {
    return new AutoTitleController({
      stateStore: this.stateStore,
      titleService,
      renameGeneratedTitle: async (threadId, title, options) => {
        const rename = threadRenameFromValue(title);
        if (!rename) return false;
        const client = currentClient();
        if (!client) return false;

        const result = await renameThreadOnAppServer(client, threadId, rename);
        if (currentClient() !== client) return false;
        if (options.shouldPublish()) {
          this.environment.plugin.threadCatalog.renameThreadInCatalog(threadId, result.name);
        }
        return true;
      },
    });
  }

  private createGoalSyncActions(currentClient: CurrentAppServerClient, status: ChatPanelSessionStatus): ChatPanelGoalSyncActions {
    return createThreadGoalSyncActions({
      stateStore: this.stateStore,
      currentClient,
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        this.dispatch({ type: "message-stream/item-upserted", item });
      },
      refreshLiveState: () => {
        this.refreshLiveState();
      },
    });
  }

  private createThreadOperations(currentClient: CurrentAppServerClient, ensureConnected: () => Promise<void>): ThreadOperations {
    const environment = this.environment;
    return new ThreadOperations({
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

  private createRuntimeSettingsActions(
    currentClient: CurrentAppServerClient,
    status: ChatPanelSessionStatus,
  ): ChatPanelRuntimeSettingsActions {
    return createChatRuntimeSettingsActions({
      stateStore: this.stateStore,
      currentClient,
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      collaborationModeLabel: () => this.collaborationModeLabel(),
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
    });
  }

  private createGoalActions(
    currentClient: CurrentAppServerClient,
    ensureConnected: () => Promise<void>,
    status: ChatPanelSessionStatus,
  ): ChatPanelGoalActions {
    return createGoalActions({
      stateStore: this.stateStore,
      currentClient,
      ensureConnected,
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        this.dispatch({ type: "message-stream/item-upserted", item });
      },
      refreshLiveState: () => {
        this.refreshLiveState();
      },
    });
  }

  private createThreadRenameEditor(
    operations: ThreadOperations,
    titleService: ThreadTitleService,
    ensureConnected: () => Promise<void>,
    status: ChatPanelSessionStatus,
  ): ThreadRenameEditorControllerInstance {
    return new ThreadRenameEditorController({
      stateStore: this.stateStore,
      ensureConnected,
      addSystemMessage: status.addSystemMessage,
      operations,
      titleService,
    });
  }

  private createThreadLifecycle(
    currentClient: CurrentAppServerClient,
    ensureConnected: () => Promise<void>,
    status: ChatPanelSessionStatus,
    goals: ChatPanelGoalActions,
    autoTitle: AutoTitleController,
  ): ChatPanelThreadLifecycle {
    return createThreadLifecycleParts({
      settingsRef: this.environment.plugin.settingsRef,
      stateStore: this.stateStore,
      client: {
        currentClient,
        ensureConnected,
      },
      lifecycle: {
        deferredTasks: this.deferredTasks,
        resumeWork: this.resumeWork,
        getOpened: () => this.opened,
        getClosing: () => this.closing,
      },
      thread: {
        notifyIdentityChanged: () => {
          this.notifyActiveThreadIdentityChanged();
        },
        refreshTabHeader: () => {
          this.refreshTabHeader();
        },
      },
      status,
      liveState: {
        refresh: () => {
          this.refreshLiveState();
        },
      },
      scroll: {
        preservePosition: () => {
          this.messageScrollIntent.preservePosition();
        },
        forceBottom: () => {
          this.messageScrollIntent.forceBottom();
        },
      },
      goals,
      resetThreadTurnPresence: (hadTurns) => {
        autoTitle.resetThreadTurnPresence(hadTurns);
      },
    });
  }

  private createComposerSurface(
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

  private createComposerController(
    composerSurface: ChatPanelComposerSurface,
    runtimeSettings: ChatPanelRuntimeSettingsActions,
    messageStreamScrollBridge: MessageStreamScrollBridge,
  ): ChatComposerController {
    const environment = this.environment;
    const stateStore = this.stateStore;
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
        this.refreshLiveState();
      },
      onHeightChange: () => {
        messageStreamScrollBridge.repinMessageStreamToBottomIfPinned();
      },
    });
  }

  private createThreadActionParts(input: {
    operations: ThreadOperations;
    ensureConnected: () => Promise<void>;
    currentClient: CurrentAppServerClient;
    status: ChatPanelSessionStatus;
    composerController: ChatComposerController;
    resume: ResumeController;
    fetchActiveThreads: () => Promise<void>;
  }): ChatPanelThreadActionParts {
    const { operations, ensureConnected, currentClient, status, composerController, resume, fetchActiveThreads } = input;
    const environment = this.environment;
    const threadManagementHost: ThreadManagementActionsHost = {
      stateStore: this.stateStore,
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
        this.notifyActiveThreadIdentityChanged();
      },
      refreshAfterThreadMutation: async () => {
        await fetchActiveThreads();
      },
    };
    const actions = createThreadManagementActions(threadManagementHost);
    const toolbarPanels = createToolbarPanelActions({
      stateStore: this.stateStore,
      threadActions: actions,
    });
    const selection = createSelectionActions({
      stateStore: this.stateStore,
      closeForThreadSelection: () => {
        toolbarPanels.closeForThreadSelection();
      },
      focusThreadInOpenView: (threadId) => environment.plugin.workspace.focusThreadInOpenView(threadId),
      resumeThread: (threadId) => resume.resumeThread(threadId),
      addSystemMessage: status.addSystemMessage,
    });
    return { actions, toolbarPanels, selection };
  }

  private createComposerAndTurnActions(input: {
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
  }): ChatPanelComposerAndTurnParts {
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
      stateStore: this.stateStore,
      responder: inboundController,
      composerHasFocus: () => composerController.hasFocus(),
      refreshLiveState: () => {
        this.refreshLiveState();
      },
    });
    const reconnectHost: ChatReconnectActionsHost = {
      stateStore: this.stateStore,
      invalidateConnectionWork: () => {
        this.connectionWork.invalidate();
      },
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      clearDeferredDiagnostics: () => {
        this.deferredTasks.clearDiagnostics();
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
        vaultPath: this.environment.plugin.settingsRef.vaultPath,
        stateStore: this.stateStore,
        client: {
          currentClient,
          ensureConnected,
        },
        status,
        runtime: {
          connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
          modelStatusLines: () => this.modelStatusLines(),
          effortStatusLines: () => this.effortStatusLines(),
          statusSummaryLines: () => this.statusSummaryLines(),
          mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
        },
        thread: {
          ensureRestoredThreadLoaded: () =>
            threadLifecycle.restoration.ensureLoaded((threadId) => threadLifecycle.resume.resumeThread(threadId)),
          startNewThread: () => this.startNewThread(),
          selectThread: (threadId) => selection.selectThread(threadId),
          notifyIdentityChanged: () => {
            this.notifyActiveThreadIdentityChanged();
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
            this.messageScrollIntent.followBottom();
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

  private createSurfacesAndPresenter(input: {
    connection: ConnectionManager;
    connectionController: ChatConnectionController;
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
  }): ChatPanelSurfacePresenterParts {
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
    const environment = this.environment;
    const toolbarActions = createChatPanelToolbarActions(
      {
        stateStore: this.stateStore,
        startNewThread: () => this.startNewThread(),
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
        stateStore: this.stateStore,
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
        store: this.stateStore,
      },
      workspace: {
        vaultPath: environment.plugin.settingsRef.vaultPath,
      },
      scroll: {
        consumeIntent: () => this.messageScrollIntent.consumeIntent(),
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
        pendingSignature: () =>
          pendingRequestsSignature(
            this.state.requests.approvals,
            this.state.requests.pendingUserInputs,
            this.state.requests.userInputDrafts,
          ),
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

  private createConnectionBundle(input: ChatPanelConnectionBundleInput): ChatPanelConnectionBundle {
    const { connection, currentClient, status, goalSync, autoTitle } = input;
    const environment = this.environment;
    const stateStore = this.stateStore;
    const serverMetadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: environment.plugin.settingsRef.vaultPath,
      currentClient,
      updateAppServerMetadata: (updater) => environment.plugin.appServerData.updateAppServerMetadata(updater),
      appServerMetadataSnapshot: () => environment.plugin.appServerData.appServerMetadataSnapshot(),
      fetchAppServerMetadata: () => environment.plugin.appServerData.fetchAppServerMetadata(),
      refreshAppServerMetadata: (options) => environment.plugin.appServerData.refreshAppServerMetadata(options),
    });
    const serverDiagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: environment.plugin.settingsRef.vaultPath,
      currentClient,
      updateAppServerMetadata: (updater) => environment.plugin.appServerData.updateAppServerMetadata(updater),
      appServerMetadataSnapshot: () => environment.plugin.appServerData.appServerMetadataSnapshot(),
    });
    const serverThreads = createChatServerThreadActions({
      stateStore,
      vaultPath: environment.plugin.settingsRef.vaultPath,
      currentClient,
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      publishThreadList: (threads) => {
        environment.plugin.threadCatalog.setActiveThreads(threads);
      },
      syncThreadGoal: (threadId) => {
        void goalSync.syncThreadGoal(threadId);
      },
    });
    const loadSharedThreadList = () => this.loadSharedThreadList();
    const serverRequestHost = { currentClient };
    const inboundController = new ChatInboundController(stateStore, {
      fetchActiveThreads: () => {
        void loadSharedThreadList();
      },
      refreshRateLimits: () => {
        void serverMetadata.refreshPublishedRateLimits();
      },
      refreshSkills: (forceReload) => void serverMetadata.refreshPublishedSkills(forceReload),
      applyAppServerMetadataSnapshot: () => {
        serverMetadata.applyAppServerMetadataSnapshot();
      },
      maybeNameThread: (threadId, turnId, completedSummary) => {
        autoTitle.maybeAutoTitleThread(threadId, turnId, completedSummary);
      },
      applyThreadArchived: (threadId) => {
        environment.plugin.threadCatalog.archiveThreadInCatalog(threadId);
      },
      applyThreadRenamed: (threadId, name) => {
        environment.plugin.threadCatalog.renameThreadInCatalog(threadId, name);
      },
      recordMcpStartupStatus: (name, mcpStatus, message) => {
        serverDiagnostics.recordMcpStartupStatus(name, mcpStatus, message);
      },
      respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
    });
    const connectionExitHost = {
      stateStore,
      connectionWork: this.connectionWork,
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      setStatus: status.set,
      resetThreadTurnPresence: (hadTurns: boolean) => {
        autoTitle.resetThreadTurnPresence(hadTurns);
      },
      refreshLiveState: () => {
        this.refreshLiveState();
      },
    };
    const connectionController = new ChatConnectionController({
      ...connectionExitHost,
      connection: {
        connect: () =>
          connection.connect({
            onNotification: (notification) => {
              inboundController.handleNotification(notification);
              this.deferLiveStateRefresh();
            },
            onServerRequest: (request) => {
              inboundController.handleServerRequest(request);
              this.deferLiveStateRefresh();
            },
            onLog: (message) => {
              inboundController.handleAppServerLog(message);
            },
            onExit: () => {
              handleChatConnectionExit(connectionExitHost);
            },
          }),
        currentClient,
        isConnected: () => connection.isConnected(),
      },
      metadata: {
        refreshPublishedAppServerMetadata: () => serverMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => serverMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedDiagnosticProbes: (options) => serverDiagnostics.refreshPublishedDiagnosticProbes(options),
      },
      loadSharedThreadList,
      scheduleDeferredDiagnostics: () => {
        this.deferredTasks.scheduleDiagnostics(() => {
          if (connection.isConnected()) {
            void serverDiagnostics.refreshPublishedDiagnosticProbes({ appServerMetadataSnapshot: true });
          }
        });
      },
      clearDeferredDiagnostics: () => {
        this.deferredTasks.clearDiagnostics();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
      configuredCommand: () => environment.plugin.settingsRef.settings.codexPath,
      refreshLiveState: () => {
        this.refreshLiveState();
      },
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    });

    return {
      connection: {
        manager: connection,
        controller: connectionController,
      },
      inboundController,
      serverActions: {
        threads: serverThreads,
        metadata: serverMetadata,
        diagnostics: serverDiagnostics,
      },
    };
  }

  private createSessionStatus(): ChatPanelSessionStatus {
    return {
      set: (statusText, phase) => {
        this.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
      },
      addSystemMessage: (text) => {
        this.dispatch({ type: "message-stream/system-item-added", item: this.systemItem(text) });
      },
      addStructuredSystemMessage: (text, details) => {
        this.dispatch({ type: "message-stream/system-item-added", item: this.structuredSystemItem(text, details) });
      },
    };
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.stateStore.dispatch(action);
  }

  displayTitle(): string {
    return codexPanelDisplayTitle(this.state.activeThread.id, this.state.threadList.listedThreads, this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    const threadId = this.state.activeThread.id;
    if (!threadId) return { version: 1 };

    const threadTitle = this.restoredThreadTitle() ?? this.activeThreadTitle();
    return {
      version: 1,
      threadId,
      ...(threadTitle ? { threadTitle } : {}),
    };
  }

  applyViewState(state: unknown): void {
    const restoredThread = parseRestoredThreadState(state);
    if (restoredThread) {
      this.parts.thread.restoration.restore(restoredThread);
      this.scheduleRestoredThreadHydration();
      return;
    }

    this.invalidateResumeWork();
    this.parts.thread.restoration.clear();
    this.parts.thread.restoration.clearHydration();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (!appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.observedAppServerContext = nextContext;
      this.connectionWork.invalidate();
      this.invalidateResumeWork();
      this.parts.connection.manager.resetConnection();
      this.applyCachedAppServerState();
    }
    this.mountOrRepairShell();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  async runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    const client = this.parts.connection.manager.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const result = await operation(client);
    if (this.parts.connection.manager.currentClient() !== client) {
      throw new Error("Codex app-server connection changed while loading shared data.");
    }
    return result;
  }

  private receiveObservedThreads(threads: readonly Thread[]): void {
    this.parts.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
  }

  private receiveObservedThreadResult(result: AppServerObservedQueryResult<readonly Thread[]>): void {
    if (result.data) this.receiveObservedThreads(result.data);
  }

  private receiveObservedAppServerMetadata(metadata: SharedServerMetadata): void {
    this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
  }

  private receiveObservedAppServerMetadataResult(result: AppServerObservedQueryResult<SharedServerMetadata>): void {
    if (result.data) this.receiveObservedAppServerMetadata(result.data);
  }

  private receiveObservedModels(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
  }

  private receiveObservedModelsResult(result: AppServerObservedQueryResult<readonly ModelMetadata[]>): void {
    if (result.data) this.receiveObservedModels(result.data);
  }

  openPanelSnapshot(): ChatPanelSnapshot {
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.state.activeThread.id,
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingApprovals: this.state.requests.approvals.length,
      pendingUserInputs: this.state.requests.pendingUserInputs.length,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.parts.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.parts.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.parts.thread.restoration.isPending(threadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  focusComposer(): void {
    this.parts.composer.controller.focus();
  }

  applyThreadArchived(threadId: string): void {
    this.parts.thread.identity.applyThreadArchived(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    this.parts.thread.identity.applyThreadRenamed(threadId, name);
  }

  open(): void {
    this.opened = true;
    this.closing = false;
    this.parts.composer.controller.registerNoteIndexInvalidation((eventRef) => {
      this.environment.obsidian.registerEvent(eventRef);
    });
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.subscribeAppServerState();
    this.mountOrRepairShell();
    this.scheduleWarmup();
    this.scheduleRestoredThreadHydration();
  }

  close(): void {
    this.opened = false;
    this.closing = true;
    this.connectionWork.invalidate();
    this.invalidateResumeWork();
    this.deferredTasks.clearAll();
    this.unsubscribeAppServerState();
    const panelRoot = this.environment.view.panelRoot();
    this.parts.render.messageStreamPresenter.dispose();
    this.parts.composer.controller.dispose();
    unmountChatPanelShell(panelRoot);
    this.parts.connection.manager.disconnect();
    this.refreshLiveState();
    this.deferLiveStateRefresh();
  }

  setComposerText(text: string): void {
    this.parts.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.parts.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    if (chatTurnBusy(this.state)) return;

    this.parts.thread.identity.clearActiveThreadContext();
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "connection/status-set", statusText: "New chat." });
    this.focusComposer();
  }

  private applyCachedAppServerState(): void {
    const threads = this.environment.plugin.threadCatalog.activeThreadsSnapshot();
    if (threads) this.parts.serverActions.threads.applyThreadList(threads);
    const metadata = this.environment.plugin.appServerData.appServerMetadataSnapshot();
    if (metadata) this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
    const models = this.environment.plugin.appServerData.modelsSnapshot();
    if (models) this.receiveObservedModels(models);
  }

  private subscribeAppServerState(): void {
    this.unsubscribeAppServerState();
    this.applyCachedAppServerState();
    this.appServerStateUnsubscribers.push(
      this.environment.plugin.threadCatalog.observeActiveThreadsResult(
        (result) => {
          this.receiveObservedThreadResult(result);
        },
        { emitCurrent: false },
      ),
      this.environment.plugin.appServerData.observeAppServerMetadataResult(
        (result) => {
          this.receiveObservedAppServerMetadataResult(result);
        },
        { emitCurrent: false },
      ),
      this.environment.plugin.appServerData.observeModelsResult(
        (result) => {
          this.receiveObservedModelsResult(result);
        },
        { emitCurrent: false },
      ),
    );
  }

  private unsubscribeAppServerState(): void {
    while (this.appServerStateUnsubscribers.length > 0) {
      this.appServerStateUnsubscribers.pop()?.();
    }
  }

  private mountOrRepairShell(): void {
    const root = this.environment.view.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: this.stateStore,
      showToolbar: this.environment.plugin.settingsRef.settings.showToolbar,
      parts: {
        toolbar: {
          surface: this.parts.surface.toolbar,
          actions: this.parts.toolbar.actions,
        },
        goal: this.parts.surface.goal,
        messageStream: this.parts.render.messageStreamPresenter,
        composer: {
          controller: this.parts.composer.controller,
          actions: {
            submit: () => void this.parts.composer.submission.submit(),
          },
        },
      },
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.parts.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.parts.connection.controller.ensureConnected();
    });
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
    this.parts.thread.history.invalidate();
  }

  private async loadSharedThreadList(): Promise<void> {
    try {
      const threads = await this.environment.plugin.threadCatalog.refreshActiveThreads();
      this.parts.serverActions.threads.applyThreadList(threads);
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      throw error;
    }
  }

  private notifyActiveThreadIdentityChanged(): void {
    this.refreshTabHeader();
    this.environment.obsidian.requestWorkspaceLayoutSave();
  }

  private refreshTabHeader(): void {
    this.environment.view.refreshTabHeader();
  }

  private refreshLiveState(): void {
    this.environment.plugin.threadCatalog.refreshThreadsViewLiveState();
  }

  private deferLiveStateRefresh(): void {
    this.viewWindow().setTimeout(() => {
      this.refreshLiveState();
    }, 0);
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
  }

  private currentAppServerContext(): AppServerQueryContext {
    return {
      codexPath: this.environment.plugin.settingsRef.settings.codexPath,
      vaultPath: this.environment.plugin.settingsRef.vaultPath,
    };
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.parts.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.environment.view.viewWindow() as (Window & { Element: typeof Element }) | null,
      contains: (element) => this.environment.view.containsElement(element),
      renameEditing: this.parts.thread.rename.isEditing(),
    });
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
  }

  private restoredThreadTitle(): string | null {
    return this.parts.thread.restoration.title();
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.parts.thread.restoration.ensureLoaded((threadId) => this.parts.thread.resume.resumeThread(threadId));
  }

  private scheduleRestoredThreadHydration(): void {
    this.parts.thread.restoration.scheduleHydration((threadId) => this.parts.thread.resume.resumeThread(threadId));
  }

  private statusSummaryLines(): string[] {
    return buildStatusSummaryLines({
      activeThreadId: this.state.activeThread.id,
      snapshot: this.runtimeSnapshot(),
      nowMs: Date.now(),
    });
  }

  private modelStatusLines(): string[] {
    return buildModelStatusLines({
      runtimeConfig: this.state.connection.runtimeConfig,
      requestedModel: this.state.runtime.requestedModel,
      snapshot: this.runtimeSnapshot(),
      collaborationModeLabel: this.collaborationModeLabel(),
    });
  }

  private effortStatusLines(): string[] {
    return buildEffortStatusLines({
      runtimeConfig: this.state.connection.runtimeConfig,
      requestedReasoningEffort: this.state.runtime.requestedReasoningEffort,
      snapshot: this.runtimeSnapshot(),
    });
  }

  private connectionDiagnosticDetails(): MessageStreamNoticeSection[] {
    return connectionDiagnosticsModel({
      state: this.state,
      connected: this.parts.connection.manager.isConnected(),
      configuredCommand: this.environment.plugin.settingsRef.settings.codexPath,
    }).map((section) => ({
      title: section.title,
      auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.runtime.selectedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return runtimeSnapshotForChatState(this.state);
  }

  private systemItem(text: string): MessageStreamItem {
    return createSystemItem(this.localItemIds.next("system"), text);
  }

  private structuredSystemItem(text: string, details: MessageStreamNoticeSection[]): MessageStreamItem {
    return createStructuredSystemItem(this.localItemIds.next("system"), text, details);
  }
}
