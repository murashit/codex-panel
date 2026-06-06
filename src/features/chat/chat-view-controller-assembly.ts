import { Notice, type App, type Component, type EventRef, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager } from "../../app-server/connection-manager";
import type { ArchiveExportAdapter } from "../../domain/threads/export";
import type { RuntimeSnapshot } from "../../runtime/state";
import { currentModel } from "../../runtime/state";
import { recoverRolloutTokenUsage } from "../../app-server/rollout-token-usage";
import type { ChatState, ChatStateStore } from "./chat-state";
import type { DisplayDetailSection } from "./display/types";
import type { ComposerMetaViewModel } from "./view-model";
import { ChatAppServerController } from "./chat-app-server-controller";
import { ChatComposerController } from "./chat-composer-controller";
import { ChatController } from "./chat-controller";
import type { CodexChatHost } from "./chat-host";
import { ChatMessageRenderer } from "./chat-message-renderer";
import type { ChatViewEffects } from "./view-effects";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./view-lifecycle";
import { ChatThreadActionController } from "./thread-actions";
import { ThreadHistoryLoader } from "./thread-history";
import { ThreadRenameController } from "./thread-rename";
import { ChatRuntimeSettingsController } from "./runtime-settings-controller";
import { ChatGoalController } from "./goal-controller";
import { ToolbarPanelController } from "./toolbar-panel-controller";
import { AppServerWarmupController } from "./controllers/connection/app-server-warmup-controller";
import { ChatConnectionController } from "./controllers/connection/connection-controller";
import { ChatReconnectController } from "./controllers/connection/reconnect-controller";
import { PendingRequestController } from "./controllers/requests/pending-request-controller";
import { ServerRequestResponder } from "./controllers/requests/server-request-responder";
import {
  createChatShellRenderPort,
  createConnectionStatePort,
  createPanelUiStatePort,
  createPendingRequestStatePort,
  createSubmissionStatePort,
  createThreadLifecycleStatePort,
} from "./controllers/state-ports";
import { ComposerSubmissionController } from "./controllers/submission/composer-submission-controller";
import { PlanImplementationController } from "./controllers/submission/plan-implementation-controller";
import { SlashCommandController } from "./controllers/submission/slash-command-controller";
import { TurnSubmissionController } from "./controllers/submission/turn-submission-controller";
import { RestoredThreadController } from "./controllers/thread/restored-thread-controller";
import { ThreadIdentityController } from "./controllers/thread/thread-identity-controller";
import { ThreadResumeController } from "./controllers/thread/thread-resume-controller";
import { ThreadSelectionController } from "./controllers/thread/thread-selection-controller";
import type { ChatMessageScrollController } from "./controllers/view/message-scroll-controller";
import { ChatViewOpenCloseController } from "./controllers/view/view-open-close-controller";
import { ChatViewRenderController } from "./controllers/view/view-render-controller";
import { ChatViewStateController } from "./controllers/view/view-state-controller";

export interface ChatViewControllerAssembly {
  connection: ConnectionManager;
  controller: ChatController;
  appServer: ChatAppServerController;
  connectionController: ChatConnectionController;
  history: ThreadHistoryLoader;
  threadResume: ThreadResumeController;
  threadActions: ChatThreadActionController;
  runtimeSettings: ChatRuntimeSettingsController;
  goals: ChatGoalController;
  restoredThread: RestoredThreadController;
  threadIdentity: ThreadIdentityController;
  threadRename: ThreadRenameController;
  pendingRequests: PendingRequestController;
  toolbarPanels: ToolbarPanelController;
  reconnectActions: ChatReconnectController;
  composerController: ChatComposerController;
  messageRenderer: ChatMessageRenderer;
  renderController: ChatViewRenderController;
  openCloseController: ChatViewOpenCloseController;
  viewStateController: ChatViewStateController;
  appServerWarmup: AppServerWarmupController;
  composerSubmission: ComposerSubmissionController;
  threadSelection: ThreadSelectionController;
}

export interface ChatViewControllerAssemblyHost {
  app: App;
  owner: Component;
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  viewId: string;
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  connectionWork: ChatConnectionWorkTracker;
  messageScroll: ChatMessageScrollController;
  effects: ChatViewEffects;
  getState: () => ChatState;
  getClient: () => AppServerClient | null;
  setClient: (client: AppServerClient | null) => void;
  getOpened: () => boolean;
  setOpened: (opened: boolean) => void;
  getClosing: () => boolean;
  setClosing: (closing: boolean) => void;
  panelRoot: () => HTMLElement | null;
  renderToolbar: (toolbar: HTMLElement) => void;
  renderGoal: (goal: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
  pendingRequestsSignature: () => string;
  activeComposerThreadName: () => string | null;
  composerPlaceholder: () => string;
  composerMetaViewModel: () => ComposerMetaViewModel;
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startNewThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  publishAppServerMetadataSnapshot: () => void;
  loadSharedThreadList: () => Promise<void>;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  registerEvent: (eventRef: EventRef) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  isOwnLeaf: (leaf: WorkspaceLeaf | null) => boolean;
  archiveAdapter: () => ArchiveExportAdapter;
}

export function createChatViewControllerAssembly(host: ChatViewControllerAssemblyHost): ChatViewControllerAssembly {
  let controller!: ChatController;
  let appServer!: ChatAppServerController;
  let connectionController!: ChatConnectionController;
  let history!: ThreadHistoryLoader;
  let threadResume!: ThreadResumeController;
  let threadActions!: ChatThreadActionController;
  let runtimeSettings!: ChatRuntimeSettingsController;
  let goals!: ChatGoalController;
  let restoredThread!: RestoredThreadController;
  let threadIdentity!: ThreadIdentityController;
  let threadRename!: ThreadRenameController;
  let pendingRequests!: PendingRequestController;
  let toolbarPanels!: ToolbarPanelController;
  let reconnectActions!: ChatReconnectController;
  let composerController!: ChatComposerController;
  let messageRenderer!: ChatMessageRenderer;
  let renderController!: ChatViewRenderController;
  let openCloseController!: ChatViewOpenCloseController;
  let viewStateController!: ChatViewStateController;
  let appServerWarmup!: AppServerWarmupController;
  let turnSubmission!: TurnSubmissionController;
  let slashCommands!: SlashCommandController;
  let composerSubmission!: ComposerSubmissionController;
  let planImplementation!: PlanImplementationController;
  let threadSelection!: ThreadSelectionController;
  let serverRequestResponder!: ServerRequestResponder;
  const connectionState = createConnectionStatePort(host.stateStore);
  const panelState = createPanelUiStatePort(host.stateStore);
  const submissionState = createSubmissionStatePort(host.stateStore);
  const threadState = createThreadLifecycleStatePort(host.stateStore);

  renderController = new ChatViewRenderController({
    shell: createChatShellRenderPort(host.stateStore, {
      connected: () => connection.isConnected(),
      showToolbar: () => host.plugin.settings.showToolbar,
      pendingRequestsSignature: host.pendingRequestsSignature,
      activeComposerThreadName: host.activeComposerThreadName,
    }),
    panelRoot: host.panelRoot,
    renderToolbar: host.renderToolbar,
    renderGoal: host.renderGoal,
    renderMessages: host.renderMessages,
    renderComposer: host.renderComposer,
    clearScheduledRender: () => {
      host.deferredTasks.clearRender();
    },
  });
  turnSubmission = new TurnSubmissionController({
    state: submissionState,
    connection: {
      vaultPath: host.plugin.vaultPath,
      currentClient: host.getClient,
    },
    restoredThread: {
      ensureRestoredThreadLoaded: host.ensureRestoredThreadLoaded,
    },
    thread: {
      startThread: (preview) => appServer.startThread(preview),
      notifyActiveThreadIdentityChanged: host.effects.thread.notifyIdentityChanged,
      resetThreadTurnPresence: host.effects.thread.resetTurnPresence,
    },
    runtime: {
      applyPendingThreadSettings: () => runtimeSettings.applyPendingThreadSettings(),
    },
    composer: {
      codexInput: (text) => composerController.codexInput(text),
      setDraft: (text, options) => {
        composerController.setDraft(text, options);
      },
    },
    view: {
      forceMessagesToBottom: host.effects.scroll.forceBottom,
      render: host.effects.render.now,
      scheduleRender: host.effects.render.schedule,
    },
    status: {
      setStatus: host.effects.status.set,
      addSystemMessage: host.effects.status.addSystemMessage,
    },
  });
  slashCommands = new SlashCommandController({
    state: submissionState,
    currentClient: host.getClient,
    codexInput: (text) => composerController.codexInput(text),
    threads: {
      startNewThread: host.startNewThread,
      resumeThread: host.selectThread,
      forkThread: (threadId) => threadActions.forkThread(threadId),
      rollbackThread: (threadId) => threadActions.rollbackThread(threadId),
      archiveThread: (threadId) => threadActions.archiveThread(threadId),
      renameThread: (threadId, name) => threadRename.rename(threadId, name),
      reconnect: () => reconnectActions.reconnectPanel(),
    },
    runtime: {
      toggleFastMode: () => runtimeSettings.toggleFastMode(),
      toggleCollaborationMode: () => runtimeSettings.toggleCollaborationMode(),
      toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
      setRequestedModel: (model) => runtimeSettings.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => runtimeSettings.setRequestedReasoningEffort(effort),
    },
    goals: {
      activeGoal: () => goals.activeGoal(),
      setObjective: (threadId, objective, tokenBudget) => goals.setObjective(threadId, objective, tokenBudget),
      setStatus: (threadId, status) => goals.setStatus(threadId, status),
      clear: (threadId) => goals.clear(threadId),
    },
    status: {
      addSystemMessage: host.effects.status.addSystemMessage,
      addStructuredSystemMessage: host.effects.status.addStructuredSystemMessage,
      setStatus: host.effects.status.set,
      statusSummaryLines: host.statusSummaryLines,
      connectionDiagnosticDetails: host.connectionDiagnosticDetails,
      mcpStatusLines: host.mcpStatusLines,
      modelStatusLines: host.modelStatusLines,
      effortStatusLines: host.effortStatusLines,
    },
  });
  messageRenderer = new ChatMessageRenderer({
    app: host.app,
    owner: host.owner,
    stateStore: host.stateStore,
    vaultPath: host.plugin.vaultPath,
    consumeScrollIntent: () => host.messageScroll.consumeIntent(),
    loadOlderTurns: () => void history.loadOlder(),
    rollbackThread: (threadId) => void threadActions.rollbackThread(threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
    implementPlan: (item) => void planImplementation.implement(item),
    openTurnDiff: (state) => void host.plugin.openTurnDiff(state),
    pendingRequestsSignature: host.pendingRequestsSignature,
    renderPendingRequests: () => pendingRequests.renderNode(),
  });
  composerController = new ChatComposerController({
    app: host.app,
    stateStore: host.stateStore,
    viewId: host.viewId,
    sendShortcut: () => host.plugin.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => host.plugin.settings.scrollThreadFromComposerEdges,
    canInterrupt: () =>
      host.getState().turnLifecycle.kind !== "idle" && Boolean(host.getState().activeThreadId && activeTurnId(host.getState())),
    composerPlaceholder: host.composerPlaceholder,
    composerMeta: host.composerMetaViewModel,
    currentModelForSuggestions: () => currentModel(host.runtimeSnapshot()),
    togglePlan: () => void runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
    toggleFast: () => void runtimeSettings.toggleFastMode(),
    renderIfDetached: host.effects.render.now,
    onDraftChange: host.effects.liveState.refresh,
    onComposerResize: () => {
      host.effects.scroll.correctAfterLayoutChange();
    },
    onSubmit: () => void composerSubmission.submit(),
    onThreadScrollFromComposer: (action) => {
      messageRenderer.scrollFromComposer(action);
    },
  });
  composerSubmission = new ComposerSubmissionController({
    state: submissionState,
    composer: composerController,
    slashCommands,
    turnSubmission,
    connection: {
      currentClient: host.getClient,
      ensureConnected: host.effects.client.ensureConnected,
    },
    status: {
      setStatus: host.effects.status.set,
      addSystemMessage: host.effects.status.addSystemMessage,
    },
  });
  serverRequestResponder = new ServerRequestResponder({
    currentClient: host.getClient,
  });
  planImplementation = new PlanImplementationController({
    state: submissionState,
    connection: {
      currentClient: host.getClient,
      ensureConnected: host.effects.client.ensureConnected,
    },
    submission: {
      sendTurnText: (text) => turnSubmission.sendTurnText(text),
    },
  });
  const connection = new ConnectionManager(() => host.plugin.settings.codexPath, host.plugin.vaultPath, {
    onNotification: (notification) => {
      controller.handleNotification(notification);
      host.effects.liveState.refresh();
      host.effects.render.schedule();
    },
    onServerRequest: (request) => {
      controller.handleServerRequest(request);
      host.effects.liveState.refresh();
      host.effects.render.now();
    },
    onLog: (message) => {
      controller.handleAppServerLog(message);
      host.effects.render.now();
    },
    onExit: () => {
      connectionController.handleExit();
    },
  });
  appServerWarmup = new AppServerWarmupController({
    deferredTasks: host.deferredTasks,
    opened: host.getOpened,
    closing: host.getClosing,
    connected: () => connection.isConnected(),
    ensureConnected: host.effects.client.ensureConnected,
  });
  openCloseController = new ChatViewOpenCloseController({
    setOpened: host.setOpened,
    setClosing: host.setClosing,
    registerEvent: host.registerEvent,
    registerComposerNoteIndexInvalidation: (register) => {
      composerController.registerNoteIndexInvalidation(register);
    },
    registerPointerDown: host.registerPointerDown,
    registerActiveLeafChange: host.registerActiveLeafChange,
    isOwnLeaf: host.isOwnLeaf,
    scrollMessagesToBottomOnFocus: host.effects.scroll.bottomOnFocus,
    applyCachedSharedAppServerState: () => {
      applyCachedSharedAppServerState(host, appServer);
    },
    render: host.effects.render.now,
    scheduleDeferredAppServerWarmup: host.effects.lifecycle.scheduleDeferredAppServerWarmup,
    scheduleDeferredRestoredThreadHydration: host.effects.lifecycle.scheduleDeferredRestoredThreadHydration,
    closeToolbarPanelOnOutsidePointer: host.closeToolbarPanelOnOutsidePointer,
    invalidateConnectionWork: host.effects.lifecycle.invalidateConnectionWork,
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    clearDeferredTasks: () => {
      host.deferredTasks.clearAll();
    },
    panelRoot: host.panelRoot,
    disposeMessages: () => {
      messageRenderer.dispose();
    },
    disposeComposer: () => {
      composerController.dispose();
    },
    disconnect: () => {
      connection.disconnect();
    },
    clearClient: host.effects.client.clear,
    refreshLiveState: host.effects.liveState.refresh,
    deferRefreshLiveState: host.effects.liveState.deferRefresh,
  });
  controller = new ChatController(host.stateStore, {
    refreshThreads: () => {
      void host.refreshThreads();
    },
    refreshRateLimits: () => {
      void appServer.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void host.refreshSkills(forceReload),
    publishAppServerMetadata: host.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turn) => {
      threadRename.maybeAutoNameThread(threadId, turn);
    },
    notifyThreadArchived: host.plugin.notifyThreadArchived.bind(host.plugin),
    notifyThreadRenamed: host.plugin.notifyThreadRenamed.bind(host.plugin),
    recordMcpStartupStatus: (name, status, message) => {
      appServer.recordMcpStartupStatus(name, status, message);
      host.effects.render.schedule();
    },
    respondToServerRequest: (requestId, result) => serverRequestResponder.respond(requestId, result),
    rejectServerRequest: (requestId, code, message) => serverRequestResponder.reject(requestId, code, message),
  });
  pendingRequests = new PendingRequestController({
    state: createPendingRequestStatePort(host.stateStore),
    controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: host.effects.liveState.refresh,
    render: host.effects.render.now,
  });
  appServer = new ChatAppServerController({
    stateStore: host.stateStore,
    vaultPath: host.plugin.vaultPath,
    currentClient: () => connection.currentClient(),
    runtimeSnapshot: host.runtimeSnapshot,
    forceMessagesToBottom: host.effects.scroll.forceBottom,
    publishThreadList: (threads) => {
      host.plugin.applyThreadListSnapshot(threads);
    },
    publishAppServerMetadata: (metadata) => {
      host.plugin.publishAppServerMetadata(metadata);
    },
    syncThreadGoal: (threadId) => {
      void goals.syncThreadGoal(threadId);
    },
  });
  connectionController = new ChatConnectionController({
    state: connectionState,
    connection,
    connectionWork: host.connectionWork,
    appServer,
    setClient: host.setClient,
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    loadSharedThreadList: host.loadSharedThreadList,
    scheduleDeferredDiagnostics: host.effects.lifecycle.scheduleDeferredDiagnostics,
    clearDeferredDiagnostics: host.effects.lifecycle.clearDeferredDiagnostics,
    refreshTabHeader: host.effects.thread.refreshTabHeader,
    resetThreadTurnPresence: host.effects.thread.resetTurnPresence,
    setStatus: host.effects.status.set,
    addSystemMessage: host.effects.status.addSystemMessage,
    configuredCommand: () => host.plugin.settings.codexPath,
    refreshLiveState: host.effects.liveState.refresh,
    render: host.effects.render.now,
    scheduleRender: host.effects.render.schedule,
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });
  history = new ThreadHistoryLoader({
    stateStore: host.stateStore,
    currentClient: host.getClient,
    render: host.effects.render.now,
    addSystemMessage: host.effects.status.addSystemMessage,
    forceMessagesToBottom: host.effects.scroll.forceBottom,
    keepCurrentScrollPosition: host.effects.scroll.preservePosition,
    setThreadTurnPresence: host.effects.thread.resetTurnPresence,
  });
  threadActions = new ChatThreadActionController({
    stateStore: host.stateStore,
    vaultPath: host.plugin.vaultPath,
    settings: () => host.plugin.settings,
    archiveAdapter: host.archiveAdapter,
    ensureConnected: host.effects.client.ensureConnected,
    currentClient: host.getClient,
    history,
    addSystemMessage: host.effects.status.addSystemMessage,
    setStatus: host.effects.status.set,
    setComposerText: host.effects.composer.setText,
    openThreadInNewView: (threadId) => host.plugin.openThreadInNewView(threadId),
    openThreadInCurrentPanel: host.selectThread,
    notifyThreadArchived: host.plugin.notifyThreadArchived.bind(host.plugin),
    notifyThreadRenamed: (threadId, name) => {
      host.plugin.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: host.effects.thread.notifyIdentityChanged,
    refreshThreads: host.refreshThreads,
    refreshSharedThreadListFromOpenSurface: () => {
      host.plugin.refreshSharedThreadListFromOpenSurface();
    },
  });
  toolbarPanels = new ToolbarPanelController({
    stateStore: host.stateStore,
    threadActions,
    scheduleRender: host.effects.render.schedule,
  });
  threadSelection = new ThreadSelectionController({
    panelState,
    threadState,
    closeForThreadSelection: () => {
      toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => host.plugin.focusThreadInOpenView(threadId),
    resumeThread: host.resumeThread,
    addSystemMessage: host.effects.status.addSystemMessage,
  });
  reconnectActions = new ChatReconnectController({
    connectionState,
    panelState,
    threadState,
    invalidateConnectionWork: host.effects.lifecycle.invalidateConnectionWork,
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    clearDeferredDiagnostics: host.effects.lifecycle.clearDeferredDiagnostics,
    reconnect: () => {
      connection.reconnect();
    },
    clearClient: host.effects.client.clear,
    setStatus: host.effects.status.set,
    render: host.effects.render.now,
    ensureConnected: host.effects.client.ensureConnected,
    resumeThread: host.resumeThread,
    addSystemMessage: host.effects.status.addSystemMessage,
  });
  runtimeSettings = new ChatRuntimeSettingsController({
    stateStore: host.stateStore,
    currentClient: host.getClient,
    runtimeSnapshot: host.runtimeSnapshot,
    collaborationModeLabel: host.collaborationModeLabel,
    addSystemMessage: host.effects.status.addSystemMessage,
  });
  goals = new ChatGoalController({
    stateStore: host.stateStore,
    currentClient: host.getClient,
    ensureConnected: host.effects.client.ensureConnected,
    addSystemMessage: host.effects.status.addSystemMessage,
    render: host.effects.render.now,
    refreshLiveState: host.effects.liveState.refresh,
  });
  restoredThread = new RestoredThreadController({
    deferredTasks: host.deferredTasks,
    opened: host.getOpened,
    resumeThread: host.resumeThread,
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    state: threadState,
    systemItem: host.effects.state.systemItem,
    setStatus: host.effects.status.set,
    refreshTabHeader: host.effects.thread.refreshTabHeader,
  });
  viewStateController = new ChatViewStateController({
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: host.effects.thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: host.effects.lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: host.effects.lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: host.effects.thread.restorePlaceholder,
  });
  threadResume = new ThreadResumeController({
    state: threadState,
    vaultPath: host.plugin.vaultPath,
    resumeWork: host.resumeWork,
    history,
    restoredThread,
    currentClient: host.getClient,
    ensureConnected: host.effects.client.ensureConnected,
    closing: host.getClosing,
    systemItem: host.effects.state.systemItem,
    resetThreadTurnPresence: host.effects.thread.resetTurnPresence,
    clearDeferredRestoredThreadHydration: host.effects.lifecycle.clearDeferredRestoredThreadHydration,
    notifyActiveThreadIdentityChanged: host.effects.thread.notifyIdentityChanged,
    addSystemMessage: host.effects.status.addSystemMessage,
    forceMessagesToBottom: host.effects.scroll.forceBottom,
    render: host.effects.render.now,
    refreshLiveState: host.effects.liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, async (filePath, options) => {
        const response = await host.getClient()?.readFile(filePath, options);
        return response?.dataBase64 ?? "";
      }),
  });
  threadIdentity = new ThreadIdentityController({
    state: threadState,
    restoredThread,
    invalidateResumeWork: host.effects.lifecycle.invalidateResumeWork,
    clearDeferredRestoredThreadHydration: host.effects.lifecycle.clearDeferredRestoredThreadHydration,
    resetThreadTurnPresence: host.effects.thread.resetTurnPresence,
    notifyActiveThreadIdentityChanged: host.effects.thread.notifyIdentityChanged,
    refreshTabHeader: host.effects.thread.refreshTabHeader,
    refreshLiveState: host.effects.liveState.refresh,
    render: host.effects.render.now,
  });
  threadRename = new ThreadRenameController({
    stateStore: host.stateStore,
    vaultPath: host.plugin.vaultPath,
    settings: () => host.plugin.settings,
    ensureConnected: host.effects.client.ensureConnected,
    currentClient: () => connection.currentClient(),
    refreshThreads: host.refreshThreads,
    render: host.effects.render.shellSlots,
    addSystemMessage: host.effects.status.addSystemMessage,
    notifyThreadRenamed: host.plugin.notifyThreadRenamed.bind(host.plugin),
  });

  return {
    connection,
    controller,
    appServer,
    connectionController,
    history,
    threadResume,
    threadActions,
    runtimeSettings,
    goals,
    restoredThread,
    threadIdentity,
    threadRename,
    pendingRequests,
    toolbarPanels,
    reconnectActions,
    composerController,
    messageRenderer,
    renderController,
    openCloseController,
    viewStateController,
    appServerWarmup,
    composerSubmission,
    threadSelection,
  };
}

function activeTurnId(state: ChatState): string | null {
  return state.turnLifecycle.kind === "running" ? state.turnLifecycle.turnId : null;
}

function applyCachedSharedAppServerState(host: ChatViewControllerAssemblyHost, appServer: ChatAppServerController): void {
  const threads = host.plugin.cachedThreadList();
  if (threads) appServer.applyThreadList(threads);
  const metadata = host.plugin.cachedAppServerMetadata();
  if (metadata) appServer.applyAppServerMetadata(metadata);
}
