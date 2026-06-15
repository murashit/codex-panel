import { Notice, type App, type Component, type EventRef } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { ArchiveExportAdapter } from "../../../app-server/services/thread-archive-markdown";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import type { ChatConnectionPhase, ChatAction, ChatState } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ChatViewDeferredTasks, ChatConnectionWorkTracker, ChatResumeWorkTracker } from "../application/lifecycle";
import type { ChatConnectionController } from "../application/connection/connection-controller";
import { reconnectPanel, type ChatReconnectActionsHost } from "../application/connection/reconnect-actions";
import { AutoTitleController } from "../application/threads/auto-title-controller";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import type { HistoryController } from "../application/threads/history-controller";
import type { IdentitySync } from "../application/threads/identity-sync";
import { activeThreadRenameTitleContext, type ThreadRenameEditorController } from "../application/threads/rename-editor-controller";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeController } from "../application/threads/resume-controller";
import { createThreadParts, createThreadSelectionActions } from "../application/threads/composition";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import { createConversationParts } from "./conversation";
import { createConversationComposer } from "./composer";
import { createChatConnectionBundle, type ChatConnectionBundle } from "./connection-bundle";
import type { ChatComposerController } from "../panel/composer-controller";
import type { ChatPanelComposerSurface, ChatPanelGoalSurface, ChatPanelToolbarSurface } from "../panel/surface/model";
import { chatPanelComposerProjection } from "../panel/surface/composer-projection";
import type { ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll-intent";
import type { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { createChatPanelGoalSurface } from "../panel/surface/goal-surface";
import { createChatPanelToolbarActions, createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ToolbarActions } from "../ui/toolbar";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { pendingRequestsSignature } from "../domain/pending-requests/signatures";
import { ThreadOperations } from "../../threads/thread-operations";
import { ThreadTitleService } from "../../threads/thread-title-service";
import type { CodexChatHost } from "../application/ports/chat-host";
import { messageStreamItems } from "../application/state/message-stream";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";

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
    rename: ThreadRenameEditorController;
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
  connectionWork: ChatConnectionWorkTracker;
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
  let connectionController: ChatConnectionController;
  const threadOperations = new ThreadOperations({
    connection: {
      ensureConnected: () => connectionController.ensureConnected(),
      currentClient,
    },
    settings: {
      current: () => environment.plugin.settingsRef.settings,
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    archiveAdapter: environment.obsidian.archiveAdapter,
    catalog: {
      archiveThreadInCatalog: (threadId) => {
        environment.plugin.threadCatalog.archiveThreadInCatalog(threadId);
      },
      renameThreadInCatalog: (threadId, name) => {
        environment.plugin.threadCatalog.renameThreadInCatalog(threadId, name);
      },
    },
    notice: (text) => {
      new Notice(text);
    },
  });
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
    operations: threadOperations,
    titleService,
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
  connectionController = controller;
  const { threads: serverThreads, diagnostics: serverDiagnostics } = serverParts.serverActions;
  const ensureConnected = () => connectionController.ensureConnected();
  const refreshThreads = () => connectionController.refreshThreads();

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
  const threadParts = createThreadParts({
    settingsRef: environment.plugin.settingsRef,
    workspace: environment.plugin.workspace,
    threadCatalog: environment.plugin.threadCatalog,
    state: {
      stateStore,
    },
    lifecycle: {
      deferredTasks: context.deferredTasks,
      resumeWork: context.resumeWork,
      getOpened: () => context.opened(),
      getClosing: () => context.closing(),
    },
    client: {
      getClient: currentClient,
      ensureConnected,
    },
    status,
    thread: {
      refreshThreads,
      notifyIdentityChanged: () => {
        context.notifyActiveThreadIdentityChanged();
      },
      refreshTabHeader: () => {
        context.refreshTabHeader();
      },
    },
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
    autoTitle,
    operations: threadOperations,
    titleService,
  });
  const { history, identity, restoration, resume, rename } = threadParts;
  const composerSurface: ChatPanelComposerSurface = {
    thread: {
      restoredPlaceholder: () => restoration.placeholder(),
    },
    runtime: {
      requestModel: (model) => runtimeSettings.requestModelFromUi(model),
      requestReasoningEffort: (effort) => runtimeSettings.requestReasoningEffortFromUi(effort),
    },
  };
  const composer = createConversationComposer(
    {
      app: environment.obsidian.app,
      settingsRef: environment.plugin.settingsRef,
      stateStore,
      viewId: environment.obsidian.viewId,
      surface: {
        composerProjection: (state) => chatPanelComposerProjection(composerSurface, state),
      },
      liveState: {
        refresh: () => {
          context.refreshLiveState();
        },
      },
    },
    {
      runtimeSettings,
    },
  );
  const threadActions = threadParts.createManagementActions({
    setText: (text) => {
      composer.controller.setDraft(text, { focus: true });
    },
  });
  const toolbarPanels = createToolbarPanelActions({
    stateStore,
    threadActions,
  });
  const selection = createThreadSelectionActions(
    {
      workspace: environment.plugin.workspace,
      state: {
        stateStore,
      },
      thread: {
        resumeThread: (threadId) => resume.resumeThread(threadId),
      },
      status,
    },
    {
      closeForThreadSelection: () => {
        toolbarPanels.closeForThreadSelection();
      },
    },
  );

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
  const conversationParts = createConversationParts(
    {
      obsidian: {
        app: environment.obsidian.app,
        owner: environment.obsidian.owner,
        viewId: environment.obsidian.viewId,
      },
      settingsRef: environment.plugin.settingsRef,
      workspace: environment.plugin.workspace,
      state: {
        stateStore,
      },
      composer,
      lifecycle: {
        messageScrollIntent: context.messageScrollIntent,
      },
      surface: {
        pendingRequestsSignature: () =>
          pendingRequestsSignature(
            context.state().requests.approvals,
            context.state().requests.pendingUserInputs,
            context.state().requests.userInputDrafts,
          ),
      },
      runtime: {
        connectionDiagnosticDetails: () => context.connectionDiagnosticDetails(),
        modelStatusLines: () => context.modelStatusLines(),
        effortStatusLines: () => context.effortStatusLines(),
        statusSummaryLines: () => context.statusSummaryLines(),
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      liveState: {
        refresh: () => {
          context.refreshLiveState();
        },
      },
      client: {
        getClient: currentClient,
        ensureConnected,
      },
      status,
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
      scroll: {
        forceBottom: () => {
          context.messageScrollIntent.forceBottom();
        },
        followBottom: () => {
          context.messageScrollIntent.followBottom();
        },
      },
    },
    {
      controller: inboundController,
      threadStarter: serverThreads,
      runtimeSettings,
      threadActions,
      reconnectPanel: reconnect,
      goals,
      history,
    },
  );
  const { composerSubmit, messageStreamPresenter } = conversationParts;
  const composerController = composer.controller;

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
