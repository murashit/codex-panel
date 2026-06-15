import { Notice, type App, type Component, type EventRef } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { renameThreadOnAppServer, threadRenameFromValue } from "../../../app-server/services/thread-rename";
import type { ArchiveExportAdapter } from "../../../app-server/services/thread-archive-markdown";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import type { SharedThreadCatalog } from "../../../workspace/shared-thread-catalog";
import { PendingRequestController } from "../application/pending-requests/controller";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { activeTurnId, type ChatConnectionPhase, type ChatAction, type ChatState } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ChatViewDeferredTasks, ChatResumeWorkTracker } from "../application/lifecycle";
import type { ChatConnectionController } from "../application/connection/connection-controller";
import { reconnectPanel, type ChatReconnectActionsHost } from "../application/connection/reconnect-actions";
import { AutoTitleController } from "../application/threads/auto-title-controller";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import type { HistoryController } from "../application/threads/history-controller";
import type { IdentitySync } from "../application/threads/identity-sync";
import {
  activeThreadRenameTitleContext,
  ThreadRenameEditorController,
  type ThreadRenameEditorController as ThreadRenameEditorControllerInstance,
} from "../application/threads/rename-editor-controller";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeController } from "../application/threads/resume-controller";
import { createSelectionActions } from "../application/threads/selection-actions";
import { createThreadLifecycleParts } from "../application/threads/lifecycle-parts";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "../application/threads/thread-management-actions";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import { createConversationTurnActions } from "../application/conversation/composition";
import { createChatConnectionBundle, type ChatConnectionBundle } from "./connection-bundle";
import { ChatComposerController } from "../panel/composer-controller";
import type { ChatPanelComposerSurface, ChatPanelGoalSurface, ChatPanelToolbarSurface } from "../panel/surface/model";
import { chatPanelComposerProjection } from "../panel/surface/composer-projection";
import type { ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll-intent";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { MessageStreamScrollBridge } from "../panel/surface/message-stream-scroll";
import { createChatPanelGoalSurface } from "../panel/surface/goal-surface";
import { createChatPanelToolbarActions, createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ToolbarActions } from "../ui/toolbar";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { pendingRequestsSignature } from "../domain/pending-requests/signatures";
import { ThreadOperations } from "../../threads/thread-operations";
import { ThreadTitleService } from "../../threads/thread-title-service";
import { messageStreamItems } from "../application/state/message-stream";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";
import type { ChatTurnDiffViewState } from "../domain/turn-diff";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly threadCatalog: ChatThreadCatalog;
}

export interface PluginSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<unknown>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
}

type ChatThreadCatalog = Pick<
  SharedThreadCatalog,
  | "archiveThreadInCatalog"
  | "renameThreadInCatalog"
  | "refreshThreadsViewLiveState"
  | "refreshFromOpenSurface"
  | "setActiveThreads"
  | "setAppServerMetadata"
  | "refreshActiveThreads"
  | "activeThreadsSnapshot"
  | "appServerMetadataSnapshot"
  | "modelsSnapshot"
  | "fetchModels"
  | "refreshModels"
  | "observeActiveThreads"
  | "observeAppServerMetadata"
  | "observeModels"
>;

export interface ChatPanelEnvironment {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
    registerEvent: (eventRef: EventRef) => void;
    registerPointerDown: (handler: (event: PointerEvent) => void) => void;
    archiveAdapter: () => ArchiveExportAdapter;
    requestWorkspaceLayoutSave: () => void;
  };
  plugin: CodexChatHost;
  view: {
    panelRoot: () => HTMLElement | null;
    viewWindow: () => Window | null;
    containsElement: (element: Element) => boolean;
    refreshTabHeader: () => void;
  };
}

export interface ChatPanelRuntimeParts {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
  };
  serverActions: {
    threads: ChatConnectionBundle["serverActions"]["threads"];
    metadata: ChatConnectionBundle["serverActions"]["metadata"];
    diagnostics: ChatConnectionBundle["serverActions"]["diagnostics"];
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

interface ChatPanelRuntimeStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

export interface ChatPanelRuntimeContext {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  deferredTasks: ChatViewDeferredTasks;
  connectionWork: ConnectionWorkTracker;
  resumeWork: ChatResumeWorkTracker;
  messageScrollIntent: ChatMessageScrollIntentState;
  state(): ChatState;
  dispatch(action: ChatAction): void;
  systemItem(text: string): MessageStreamItem;
  structuredSystemItem(text: string, details: MessageStreamNoticeSection[]): MessageStreamItem;
  opened(): boolean;
  closing(): boolean;
  startNewThread(): Promise<void>;
  invalidateResumeWork(): void;
  refreshTabHeader(): void;
  refreshLiveState(): void;
  deferLiveStateRefresh(): void;
  notifyActiveThreadIdentityChanged(): void;
  connectionDiagnosticDetails(): MessageStreamNoticeSection[];
  modelStatusLines(): string[];
  effortStatusLines(): string[];
  statusSummaryLines(): string[];
  collaborationModeLabel(): string;
}

export function createChatPanelRuntime(context: ChatPanelRuntimeContext): ChatPanelRuntimeParts {
  const { environment, stateStore } = context;
  const status = createRuntimeStatus(context);
  const connection = new ConnectionManager(
    () => environment.plugin.settingsRef.settings.codexPath,
    environment.plugin.settingsRef.vaultPath,
  );
  const currentClient = () => connection.currentClient();
  const titleService = new ThreadTitleService({
    settings: {
      current: () => environment.plugin.settingsRef.settings,
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    currentClient,
    visibleContext: (threadId) => activeThreadRenameTitleContext(context.state(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(context.state().messageStream)),
  });
  const autoTitle = new AutoTitleController({
    stateStore,
    titleService,
    renameGeneratedTitle: async (threadId, title, options) => {
      const rename = threadRenameFromValue(title);
      if (!rename) return false;
      const client = currentClient();
      if (!client) return false;

      const result = await renameThreadOnAppServer(client, threadId, rename);
      if (currentClient() !== client) return false;
      if (options.shouldPublish()) {
        environment.plugin.threadCatalog.renameThreadInCatalog(threadId, result.name);
      }
      return true;
    },
  });
  const goalSync = createThreadGoalSyncActions({
    stateStore,
    currentClient,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      context.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState: () => {
      context.refreshLiveState();
    },
  });
  const serverParts = createChatConnectionBundle({
    connection,
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    connectionWork: context.connectionWork,
    deferredTasks: context.deferredTasks,
    threadCatalog: environment.plugin.threadCatalog,
    goalSync,
    autoTitle,
    status,
    invalidateResumeWork: () => {
      context.invalidateResumeWork();
    },
    refreshTabHeader: () => {
      context.refreshTabHeader();
    },
    refreshLiveState: () => {
      context.refreshLiveState();
    },
    deferLiveStateRefresh: () => {
      context.deferLiveStateRefresh();
    },
    configuredCommand: () => environment.plugin.settingsRef.settings.codexPath,
  });
  const {
    connection: { controller },
    inboundController,
  } = serverParts;
  const connectionController = controller;
  const { threads: serverThreads, diagnostics: serverDiagnostics } = serverParts.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const fetchActiveThreads = () => connectionController.fetchActiveThreads();
  const threadOperations = new ThreadOperations({
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

  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    collaborationModeLabel: () => context.collaborationModeLabel(),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  });
  const goals = createGoalActions({
    stateStore,
    currentClient,
    ensureConnected,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      context.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState: () => {
      context.refreshLiveState();
    },
  });
  const rename = new ThreadRenameEditorController({
    stateStore,
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    operations: threadOperations,
    titleService,
  });
  const threadLifecycle = createThreadLifecycleParts({
    settingsRef: environment.plugin.settingsRef,
    stateStore,
    client: {
      currentClient,
      ensureConnected,
    },
    lifecycle: {
      deferredTasks: context.deferredTasks,
      resumeWork: context.resumeWork,
      getOpened: () => context.opened(),
      getClosing: () => context.closing(),
    },
    thread: {
      notifyIdentityChanged: () => {
        context.notifyActiveThreadIdentityChanged();
      },
      refreshTabHeader: () => {
        context.refreshTabHeader();
      },
    },
    status,
    liveState: {
      refresh: () => {
        context.refreshLiveState();
      },
    },
    scroll: {
      preservePosition: () => {
        context.messageScrollIntent.preservePosition();
      },
      forceBottom: () => {
        context.messageScrollIntent.forceBottom();
      },
    },
    goals,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  });
  const { history, identity, restoration, resume } = threadLifecycle;
  const composerSurface: ChatPanelComposerSurface = {
    thread: {
      restoredPlaceholder: () => restoration.placeholder(),
    },
    runtime: {
      requestModel: (model) => runtimeSettings.requestModelFromUi(model),
      requestReasoningEffort: (effort) => runtimeSettings.requestReasoningEffortFromUi(effort),
    },
  };
  const messageStreamScrollBridge = new MessageStreamScrollBridge();
  const composerController = new ChatComposerController({
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
      context.refreshLiveState();
    },
    onHeightChange: () => {
      messageStreamScrollBridge.repinMessageStreamToBottomIfPinned();
    },
  });
  const threadManagementHost: ThreadManagementActionsHost = {
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    operations: threadOperations,
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
      context.notifyActiveThreadIdentityChanged();
    },
    refreshAfterThreadMutation: async () => {
      await fetchActiveThreads();
    },
  };
  const threadActions = createThreadManagementActions(threadManagementHost);
  const toolbarPanels = createToolbarPanelActions({
    stateStore,
    threadActions,
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

  const pendingRequests = new PendingRequestController({
    stateStore,
    responder: inboundController,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: () => {
      context.refreshLiveState();
    },
  });
  const reconnectHost: ChatReconnectActionsHost = {
    stateStore,
    invalidateConnectionWork: () => {
      context.connectionWork.invalidate();
    },
    invalidateResumeWork: () => {
      context.invalidateResumeWork();
    },
    clearDeferredDiagnostics: () => {
      context.deferredTasks.clearDiagnostics();
    },
    reconnect: () => {
      connection.reconnect();
    },
    setStatus: (statusText, phase) => {
      status.set(statusText, phase);
    },
    ensureConnected,
    resumeThread: (threadId) => resume.resumeThread(threadId),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  };
  const reconnect = () => reconnectPanel(reconnectHost);
  const turnActions = createConversationTurnActions(
    {
      vaultPath: environment.plugin.settingsRef.vaultPath,
      stateStore,
      client: {
        currentClient,
        ensureConnected,
      },
      status,
      runtime: {
        connectionDiagnosticDetails: () => context.connectionDiagnosticDetails(),
        modelStatusLines: () => context.modelStatusLines(),
        effortStatusLines: () => context.effortStatusLines(),
        statusSummaryLines: () => context.statusSummaryLines(),
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: () => restoration.ensureLoaded((threadId) => resume.resumeThread(threadId)),
        startNewThread: () => context.startNewThread(),
        selectThread: (threadId) => selection.selectThread(threadId),
        notifyIdentityChanged: () => {
          context.notifyActiveThreadIdentityChanged();
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
          context.messageScrollIntent.followBottom();
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

  const toolbarActions = createChatPanelToolbarActions(
    {
      stateStore,
      startNewThread: () => context.startNewThread(),
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
      consumeIntent: () => context.messageScrollIntent.consumeIntent(),
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
          context.state().requests.approvals,
          context.state().requests.pendingUserInputs,
          context.state().requests.userInputDrafts,
        ),
      pendingSnapshot: () => pendingRequests.snapshot(),
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });
  const composerSubmit = turnActions.composerSubmit;

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
      panels: toolbarPanels,
      actions: toolbarActions,
    },
    composer: {
      controller: composerController,
      submission: composerSubmit,
    },
    render: {
      messageStreamPresenter,
    },
    surface: {
      toolbar: toolbarSurface,
      goal: goalSurface,
      composer: composerSurface,
    },
  };
}

function createRuntimeStatus(context: ChatPanelRuntimeContext): ChatPanelRuntimeStatus {
  return {
    set: (statusText, phase) => {
      context.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
    },
    addSystemMessage: (text) => {
      context.dispatch({ type: "message-stream/system-item-added", item: context.systemItem(text) });
    },
    addStructuredSystemMessage: (text, details) => {
      context.dispatch({ type: "message-stream/system-item-added", item: context.structuredSystemItem(text, details) });
    },
  };
}
