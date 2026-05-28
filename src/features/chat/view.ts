import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager } from "../../app-server/connection-manager";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import { createSystemItem } from "./display/system";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { Model } from "../../generated/app-server/v2/Model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../runtime/collaboration-mode";
import { ChatController } from "./chat-controller";
import { currentModel, type RuntimeSnapshot } from "../../runtime/state";
import { ChatAppServerController } from "./chat-app-server-controller";
import { ThreadHistoryLoader } from "./thread-history";
import { ThreadRenameController } from "./thread-rename";
import { pendingRequestsSignature as requestStateSignature } from "./request-state";
import type { CodexPanelSettings } from "../../settings/model";
import { ChatComposerController } from "./chat-composer-controller";
import { activeTurnId, chatTurnBusy, createChatStateStore, type ChatState, type ChatAction } from "./chat-state";
import { renderToolbar } from "./ui/toolbar";
import type { ToolbarViewModel } from "./toolbar-model";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { ChatMessageRenderer } from "./chat-message-renderer";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import { ChatThreadActionController } from "./thread-actions";
import { ChatRuntimeSettingsController } from "./runtime-settings-controller";
import { RestoredThreadController } from "./controllers/thread/restored-thread-controller";
import {
  activeComposerThreadName as buildActiveComposerThreadName,
  activeThreadTitle as buildActiveThreadTitle,
  chatViewDisplayTitle,
  connectionDiagnosticsModel,
  composerPlaceholder as buildComposerPlaceholder,
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  runtimeToolbarChoices,
  runtimeSnapshotForChatState,
  statusSummaryLines as buildStatusSummaryLines,
  toolbarViewModel as buildToolbarViewModel,
} from "./view-model";
import { openPanelTurnLifecycle } from "./view-snapshot";
import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  type ChatViewRenderScheduleOptions,
} from "./view-lifecycle";
import { ChatConnectionController } from "./controllers/connection/connection-controller";
import { ChatReconnectController } from "./controllers/connection/reconnect-controller";
import { AppServerWarmupController } from "./controllers/connection/app-server-warmup-controller";
import { PendingRequestController } from "./controllers/requests/pending-request-controller";
import { ServerRequestResponder } from "./controllers/requests/server-request-responder";
import { ComposerSubmissionController } from "./controllers/submission/composer-submission-controller";
import { PlanImplementationController } from "./controllers/submission/plan-implementation-controller";
import { SlashCommandController } from "./controllers/submission/slash-command-controller";
import { TurnSubmissionController } from "./controllers/submission/turn-submission-controller";
import { ThreadIdentityController } from "./controllers/thread/thread-identity-controller";
import { ThreadResumeController } from "./controllers/thread/thread-resume-controller";
import { ThreadSelectionController } from "./controllers/thread/thread-selection-controller";
import { ChatMessageScrollController } from "./controllers/view/message-scroll-controller";
import { ChatViewOpenCloseController } from "./controllers/view/view-open-close-controller";
import { ChatViewRenderController } from "./controllers/view/view-render-controller";
import { ChatViewStateController } from "./controllers/view/view-state-controller";
import { ToolbarPanelController } from "./toolbar-panel-controller";
import type { ChatViewEffects } from "./view-effects";

export interface CodexChatHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openThreadInNewView(threadId: string): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
  refreshSharedThreadListFromOpenSurface(): void;
  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreadList(): readonly Thread[] | null;
  publishAppServerMetadata(metadata: SharedAppServerMetadata): void;
  cachedAppServerMetadata(): SharedAppServerMetadata | null;
}

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly connection: ConnectionManager;
  private readonly controller: ChatController;
  private readonly appServer: ChatAppServerController;
  private readonly connectionController: ChatConnectionController;
  private readonly history: ThreadHistoryLoader;
  private readonly threadResume: ThreadResumeController;
  private readonly threadActions: ChatThreadActionController;
  private readonly runtimeSettings: ChatRuntimeSettingsController;
  private readonly restoredThread: RestoredThreadController;
  private readonly threadIdentity: ThreadIdentityController;
  private readonly threadRename: ThreadRenameController;
  private readonly pendingRequests: PendingRequestController;
  private readonly toolbarPanels: ToolbarPanelController;
  private readonly reconnectActions: ChatReconnectController;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly effects: ChatViewEffects;
  private readonly composerController: ChatComposerController;
  private readonly messageRenderer: ChatMessageRenderer;
  private readonly renderController: ChatViewRenderController;
  private readonly openCloseController: ChatViewOpenCloseController;
  private readonly viewStateController: ChatViewStateController;
  private readonly appServerWarmup: AppServerWarmupController;
  private readonly messageScroll: ChatMessageScrollController;
  private readonly turnSubmission: TurnSubmissionController;
  private readonly slashCommands: SlashCommandController;
  private readonly composerSubmission: ComposerSubmissionController;
  private readonly planImplementation: PlanImplementationController;
  private readonly threadSelection: ThreadSelectionController;
  private readonly serverRequestResponder: ServerRequestResponder;
  private readonly connectionWork = new ChatConnectionWorkTracker();
  private readonly resumeWork: ChatResumeWorkTracker;
  private opened = false;
  private closing = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexChatHost,
  ) {
    super(leaf);
    this.deferredTasks = new ChatViewDeferredTasks(() => this.containerEl.win);
    this.resumeWork = new ChatResumeWorkTracker(() => {
      this.history.invalidate();
    });
    this.messageScroll = new ChatMessageScrollController({
      stateStore: this.chatState,
      render: () => {
        this.render();
      },
    });
    this.effects = this.createEffects();
    this.renderController = new ChatViewRenderController({
      stateStore: this.chatState,
      panelRoot: () => this.panelRoot(),
      connected: () => this.connection.isConnected(),
      pendingRequestsSignature: () => this.pendingRequestsSignature(),
      activeComposerThreadName: () => this.activeComposerThreadName(),
      renderToolbar: (toolbar) => {
        this.renderToolbar(toolbar);
      },
      renderMessages: (parent) => {
        this.renderMessages(parent);
      },
      renderComposer: (parent) => {
        this.renderComposer(parent);
      },
      clearScheduledRender: () => {
        this.deferredTasks.clearRender();
      },
    });
    this.turnSubmission = new TurnSubmissionController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.client,
      ensureRestoredThreadLoaded: () => this.ensureRestoredThreadLoaded(),
      startThread: () => this.appServer.startThread(),
      notifyActiveThreadIdentityChanged: this.effects.notifyActiveThreadIdentityChanged,
      resetThreadTurnPresence: this.effects.resetThreadTurnPresence,
      applyPendingThreadSettings: () => this.runtimeSettings.applyPendingThreadSettings(),
      codexInput: (text) => this.composerController.codexInput(text),
      setDraft: (text, options) => {
        this.composerController.setDraft(text, options);
      },
      forceMessagesToBottom: this.effects.forceMessagesToBottom,
      render: this.effects.render,
      scheduleRender: this.effects.scheduleRender,
      setStatus: this.effects.setStatus,
      addSystemMessage: this.effects.addSystemMessage,
    });
    this.slashCommands = new SlashCommandController({
      stateStore: this.chatState,
      currentClient: () => this.client,
      codexInput: (text) => this.composerController.codexInput(text),
      startNewThread: () => this.startNewThread(),
      resumeThread: (threadId) => this.selectThread(threadId),
      forkThread: (threadId) => this.threadActions.forkThread(threadId),
      rollbackThread: (threadId) => this.threadActions.rollbackThread(threadId),
      archiveThread: (threadId) => this.threadActions.archiveThread(threadId),
      toggleFastMode: () => this.runtimeSettings.toggleFastMode(),
      toggleCollaborationMode: () => this.runtimeSettings.toggleCollaborationMode(),
      toggleAutoReview: () => void this.runtimeSettings.toggleAutoReview(),
      addSystemMessage: this.effects.addSystemMessage,
      addStructuredSystemMessage: this.effects.addStructuredSystemMessage,
      setStatus: this.effects.setStatus,
      setRequestedModel: (model) => this.runtimeSettings.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => this.runtimeSettings.setRequestedReasoningEffort(effort),
      statusSummaryLines: () => this.statusSummaryLines(),
      connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
      mcpStatusLines: () => this.mcpStatusLines(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
    });
    this.messageRenderer = new ChatMessageRenderer({
      app: this.app,
      owner: this,
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      consumeScrollIntent: () => this.messageScroll.consumeIntent(),
      loadOlderTurns: () => void this.history.loadOlder(),
      rollbackThread: (threadId) => void this.threadActions.rollbackThread(threadId),
      implementPlan: (item) => void this.planImplementation.implement(item),
      openTurnDiff: (state) => void this.plugin.openTurnDiff(state),
      pendingRequestsSignature: () => this.pendingRequestsSignature(),
      renderPendingRequests: () => this.pendingRequests.renderNode(),
    });
    this.composerController = new ChatComposerController({
      app: this.app,
      stateStore: this.chatState,
      viewId: this.viewId,
      sendShortcut: () => this.plugin.settings.sendShortcut,
      canInterrupt: () => this.turnBusy && Boolean(this.state.activeThreadId && this.activeTurnId),
      composerPlaceholder: () => this.composerPlaceholder(),
      currentModelForSuggestions: () => currentModel(this.runtimeSnapshot()),
      renderIfDetached: this.effects.render,
      onDraftChange: this.effects.refreshLiveState,
      onComposerResize: () => {
        if (this.state.messagesPinnedToBottom) this.effects.forceMessagesToBottom();
      },
      onSubmit: () => void this.composerSubmission.submit(),
      onNewThread: () => void this.startNewThread(),
    });
    this.composerSubmission = new ComposerSubmissionController({
      stateStore: this.chatState,
      composer: this.composerController,
      slashCommands: this.slashCommands,
      turnSubmission: this.turnSubmission,
      currentClient: () => this.client,
      ensureConnected: this.effects.ensureConnected,
      setStatus: this.effects.setStatus,
      addSystemMessage: this.effects.addSystemMessage,
    });
    this.serverRequestResponder = new ServerRequestResponder({
      currentClient: () => this.client,
    });
    this.planImplementation = new PlanImplementationController({
      stateStore: this.chatState,
      currentClient: () => this.client,
      ensureConnected: this.effects.ensureConnected,
      sendTurnText: (text) => this.turnSubmission.sendTurnText(text),
    });
    this.connection = new ConnectionManager(() => this.plugin.settings.codexPath, this.plugin.vaultPath, {
      onNotification: (notification) => {
        this.controller.handleNotification(notification);
        this.effects.refreshLiveState();
        this.effects.scheduleRender();
      },
      onServerRequest: (request) => {
        this.controller.handleServerRequest(request);
        this.effects.refreshLiveState();
        this.effects.render();
      },
      onLog: (message) => {
        this.controller.handleAppServerLog(message);
        this.effects.render();
      },
      onExit: () => {
        this.connectionController.handleExit();
      },
    });
    this.appServerWarmup = new AppServerWarmupController({
      deferredTasks: this.deferredTasks,
      opened: () => this.opened,
      closing: () => this.closing,
      connected: () => this.connection.isConnected(),
      ensureConnected: this.effects.ensureConnected,
    });
    this.openCloseController = new ChatViewOpenCloseController({
      setOpened: (opened) => {
        this.opened = opened;
      },
      setClosing: (closing) => {
        this.closing = closing;
      },
      registerEvent: (eventRef) => {
        this.registerEvent(eventRef);
      },
      registerComposerNoteIndexInvalidation: (register) => {
        this.composerController.registerNoteIndexInvalidation(register);
      },
      registerPointerDown: (handler) => {
        this.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
      },
      registerActiveLeafChange: (handler) => {
        this.registerEvent(this.app.workspace.on("active-leaf-change", handler));
      },
      isOwnLeaf: (leaf) => leaf === this.leaf,
      scrollMessagesToBottomOnFocus: this.effects.scrollMessagesToBottomOnFocus,
      applyCachedSharedAppServerState: () => {
        this.applyCachedSharedAppServerState();
      },
      render: this.effects.render,
      scheduleDeferredAppServerWarmup: this.effects.scheduleDeferredAppServerWarmup,
      scheduleDeferredRestoredThreadHydration: this.effects.scheduleDeferredRestoredThreadHydration,
      closeToolbarPanelOnOutsidePointer: (event) => {
        this.closeToolbarPanelOnOutsidePointer(event);
      },
      invalidateConnectionWork: this.effects.invalidateConnectionWork,
      invalidateResumeWork: this.effects.invalidateResumeWork,
      clearDeferredTasks: () => {
        this.deferredTasks.clearAll();
      },
      panelRoot: () => this.panelRoot(),
      disposeMessages: () => {
        this.messageRenderer.dispose();
      },
      disposeComposer: () => {
        this.composerController.dispose();
      },
      disconnect: () => {
        this.connection.disconnect();
      },
      clearClient: this.effects.clearClient,
      refreshLiveState: this.effects.refreshLiveState,
      deferRefreshLiveState: this.effects.deferRefreshLiveState,
    });
    this.controller = new ChatController(this.chatState, {
      refreshThreads: () => {
        void this.refreshThreads();
      },
      refreshSkills: (forceReload) => void this.refreshSkills(forceReload),
      publishAppServerMetadata: () => {
        this.publishAppServerMetadataSnapshot();
      },
      maybeNameThread: (threadId, turn) => {
        this.threadRename.maybeAutoNameThread(threadId, turn);
      },
      notifyThreadArchived: (threadId) => {
        this.plugin.notifyThreadArchived(threadId);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
      recordMcpStartupStatus: (name, status, message) => {
        this.appServer.recordMcpStartupStatus(name, status, message);
        this.effects.scheduleRender();
      },
      respondToServerRequest: (requestId, result) => this.serverRequestResponder.respond(requestId, result),
      rejectServerRequest: (requestId, code, message) => this.serverRequestResponder.reject(requestId, code, message),
    });
    this.pendingRequests = new PendingRequestController({
      stateStore: this.chatState,
      controller: this.controller,
      composerHasFocus: () => this.composerController.hasFocus(),
      refreshLiveState: this.effects.refreshLiveState,
      render: this.effects.render,
    });
    this.appServer = new ChatAppServerController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.connection.currentClient(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
      forceMessagesToBottom: this.effects.forceMessagesToBottom,
      publishAppServerMetadata: (metadata) => {
        this.plugin.publishAppServerMetadata(metadata);
      },
    });
    this.connectionController = new ChatConnectionController({
      stateStore: this.chatState,
      connection: this.connection,
      connectionWork: this.connectionWork,
      appServer: this.appServer,
      setClient: (client) => {
        this.client = client;
      },
      invalidateResumeWork: this.effects.invalidateResumeWork,
      loadSharedThreadList: () => this.loadSharedThreadList(),
      scheduleDeferredDiagnostics: this.effects.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: this.effects.clearDeferredDiagnostics,
      refreshTabHeader: this.effects.refreshTabHeader,
      resetThreadTurnPresence: this.effects.resetThreadTurnPresence,
      setStatus: this.effects.setStatus,
      addSystemMessage: this.effects.addSystemMessage,
      refreshLiveState: this.effects.refreshLiveState,
      render: this.effects.render,
      scheduleRender: this.effects.scheduleRender,
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    });
    this.history = new ThreadHistoryLoader({
      stateStore: this.chatState,
      currentClient: () => this.client,
      render: this.effects.render,
      addSystemMessage: this.effects.addSystemMessage,
      forceMessagesToBottom: this.effects.forceMessagesToBottom,
      keepCurrentScrollPosition: this.effects.preserveMessageScrollPosition,
      setThreadTurnPresence: this.effects.resetThreadTurnPresence,
    });
    this.threadActions = new ChatThreadActionController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      archiveAdapter: () => this.app.vault.adapter,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.client,
      history: this.history,
      addSystemMessage: this.effects.addSystemMessage,
      setStatus: this.effects.setStatus,
      setComposerText: this.effects.setComposerText,
      openThreadInNewView: (threadId) => this.plugin.openThreadInNewView(threadId),
      notifyThreadArchived: (threadId) => {
        this.plugin.notifyThreadArchived(threadId);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
      notifyActiveThreadIdentityChanged: this.effects.notifyActiveThreadIdentityChanged,
      refreshThreads: () => this.refreshThreads(),
      refreshSharedThreadListFromOpenSurface: () => {
        this.plugin.refreshSharedThreadListFromOpenSurface();
      },
    });
    this.toolbarPanels = new ToolbarPanelController({
      stateStore: this.chatState,
      threadActions: this.threadActions,
      scheduleRender: this.effects.scheduleRender,
    });
    this.threadSelection = new ThreadSelectionController({
      stateStore: this.chatState,
      closeForThreadSelection: () => {
        this.toolbarPanels.closeForThreadSelection();
      },
      focusThreadInOpenView: (threadId) => this.plugin.focusThreadInOpenView(threadId),
      resumeThread: (threadId) => this.resumeThread(threadId),
      addSystemMessage: this.effects.addSystemMessage,
    });
    this.reconnectActions = new ChatReconnectController({
      stateStore: this.chatState,
      activeThreadId: () => this.state.activeThreadId,
      invalidateConnectionWork: this.effects.invalidateConnectionWork,
      invalidateResumeWork: this.effects.invalidateResumeWork,
      clearDeferredDiagnostics: this.effects.clearDeferredDiagnostics,
      reconnect: () => {
        this.connection.reconnect();
      },
      clearClient: this.effects.clearClient,
      setStatus: this.effects.setStatus,
      render: this.effects.render,
      ensureConnected: this.effects.ensureConnected,
      resumeThread: (threadId) => this.resumeThread(threadId),
      addSystemMessage: this.effects.addSystemMessage,
    });
    this.runtimeSettings = new ChatRuntimeSettingsController({
      stateStore: this.chatState,
      currentClient: () => this.client,
      runtimeSnapshot: () => this.runtimeSnapshot(),
      collaborationModeLabel: () => this.collaborationModeLabel(),
      addSystemMessage: this.effects.addSystemMessage,
    });
    this.restoredThread = new RestoredThreadController({
      deferredTasks: this.deferredTasks,
      opened: () => this.opened,
      resumeThread: (threadId) => this.resumeThread(threadId),
      invalidateResumeWork: this.effects.invalidateResumeWork,
      dispatch: this.effects.dispatch,
      systemItem: this.effects.systemItem,
      setStatus: this.effects.setStatus,
      refreshTabHeader: this.effects.refreshTabHeader,
    });
    this.viewStateController = new ChatViewStateController({
      invalidateResumeWork: this.effects.invalidateResumeWork,
      clearRestoredThreadLifecycle: this.effects.clearRestoredThreadLifecycle,
      clearDeferredRestoredThreadHydration: this.effects.clearDeferredRestoredThreadHydration,
      scheduleDeferredAppServerWarmup: this.effects.scheduleDeferredAppServerWarmup,
      restoreThreadPlaceholder: this.effects.restoreThreadPlaceholder,
    });
    this.threadResume = new ThreadResumeController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      resumeWork: this.resumeWork,
      history: this.history,
      restoredThread: this.restoredThread,
      currentClient: () => this.client,
      ensureConnected: this.effects.ensureConnected,
      closing: () => this.closing,
      systemItem: this.effects.systemItem,
      resetThreadTurnPresence: this.effects.resetThreadTurnPresence,
      clearDeferredRestoredThreadHydration: this.effects.clearDeferredRestoredThreadHydration,
      notifyActiveThreadIdentityChanged: this.effects.notifyActiveThreadIdentityChanged,
      addSystemMessage: this.effects.addSystemMessage,
      forceMessagesToBottom: this.effects.forceMessagesToBottom,
      render: this.effects.render,
      refreshLiveState: this.effects.refreshLiveState,
    });
    this.threadIdentity = new ThreadIdentityController({
      stateStore: this.chatState,
      restoredThread: this.restoredThread,
      invalidateResumeWork: this.effects.invalidateResumeWork,
      clearDeferredRestoredThreadHydration: this.effects.clearDeferredRestoredThreadHydration,
      resetThreadTurnPresence: this.effects.resetThreadTurnPresence,
      notifyActiveThreadIdentityChanged: this.effects.notifyActiveThreadIdentityChanged,
      refreshTabHeader: this.effects.refreshTabHeader,
      refreshLiveState: this.effects.refreshLiveState,
      render: this.effects.render,
    });
    this.threadRename = new ThreadRenameController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.connection.currentClient(),
      refreshThreads: () => this.refreshThreads(),
      render: this.effects.renderShellSlots,
      addSystemMessage: this.effects.addSystemMessage,
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
    });
  }

  private createEffects(): ChatViewEffects {
    return {
      render: () => {
        this.render();
      },
      renderShellSlots: () => {
        this.renderShellSlots();
      },
      scheduleRender: (options) => {
        this.scheduleRender(options);
      },
      refreshLiveState: () => {
        this.plugin.refreshThreadsViewLiveState();
      },
      deferRefreshLiveState: () => {
        this.containerEl.win.setTimeout(() => {
          this.plugin.refreshThreadsViewLiveState();
        }, 0);
      },
      forceMessagesToBottom: () => {
        this.messageScroll.forceBottom();
      },
      preserveMessageScrollPosition: () => {
        this.messageScroll.preservePosition();
      },
      scrollMessagesToBottomOnFocus: () => {
        this.messageScroll.scrollToBottomOnFocus();
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        this.addStructuredSystemMessage(text, details);
      },
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      resetThreadTurnPresence: (hadTurns) => {
        this.threadRename.resetThreadTurnPresence(hadTurns);
      },
      invalidateConnectionWork: () => {
        this.invalidateConnectionWork();
      },
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      scheduleDeferredDiagnostics: () => {
        this.scheduleDeferredDiagnostics();
      },
      clearDeferredDiagnostics: () => {
        this.clearDeferredDiagnostics();
      },
      scheduleDeferredRestoredThreadHydration: () => {
        this.scheduleDeferredRestoredThreadHydration();
      },
      clearDeferredRestoredThreadHydration: () => {
        this.clearDeferredRestoredThreadHydration();
      },
      scheduleDeferredAppServerWarmup: () => {
        this.scheduleDeferredAppServerWarmup();
      },
      dispatch: (action) => {
        this.dispatch(action);
      },
      systemItem: (text) => this.systemItem(text),
      restoreThreadPlaceholder: (restoredThread) => {
        this.restoreThreadPlaceholder(restoredThread);
      },
      clearRestoredThreadLifecycle: () => {
        this.clearRestoredThreadLifecycle();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      clearClient: () => {
        this.client = null;
      },
      setComposerText: (text) => {
        this.setComposerText(text);
      },
      ensureConnected: () => this.ensureConnected(),
    };
  }

  private get state(): ChatState {
    return this.chatState.getState();
  }

  private get turnBusy(): boolean {
    return chatTurnBusy(this.state);
  }

  private get activeTurnId(): string | null {
    return activeTurnId(this.state);
  }

  private dispatch(action: ChatAction): void {
    this.chatState.dispatch(action);
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  override getDisplayText(): string {
    return chatViewDisplayTitle(this.state, this.restoredThreadTitle());
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override getState(): Record<string, unknown> {
    const threadId = this.state.activeThreadId;
    if (!threadId) return { version: 1 };

    const threadTitle = this.restoredThreadTitle() ?? this.activeThreadTitle();
    return {
      version: 1,
      threadId,
      ...(threadTitle ? { threadTitle } : {}),
    };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.viewStateController.applyState(state);
  }

  refreshSettings(): void {
    this.render();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.appServer.applyThreadList(threads);
    this.refreshTabHeader();
    this.render();
  }

  applyAppServerMetadataSnapshot(metadata: SharedAppServerMetadata): void {
    this.appServer.applyAppServerMetadata(metadata);
    this.render();
  }

  applyAvailableModelsSnapshot(models: readonly Model[]): void {
    this.dispatch({ type: "thread/list-applied", availableModels: models });
    this.render();
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return {
      viewId: this.viewId,
      threadId: this.closing ? null : this.state.activeThreadId,
      turnLifecycle: openPanelTurnLifecycle(this.state.turnLifecycle),
      pendingApprovals: this.state.approvals.length,
      pendingUserInputs: this.state.pendingUserInputs.length,
      hasComposerDraft: this.state.composerDraft.trim().length > 0,
      connected: this.connection.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.isRestoredThreadPending(threadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.messageScroll.scrollToBottomOnFocus();
    this.focusComposer();
  }

  focusComposer(): void {
    this.composerController.focus();
  }

  notifyThreadArchived(threadId: string): void {
    this.threadIdentity.notifyThreadArchived(threadId);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.threadIdentity.notifyThreadRenamed(threadId, name);
  }

  override async onOpen(): Promise<void> {
    this.openCloseController.open();
  }

  override async onClose(): Promise<void> {
    this.openCloseController.close();
  }

  setComposerText(text: string): void {
    this.composerController.setDraft(text, { focus: true, renderIfDetached: true });
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  private async ensureConnected(): Promise<void> {
    await this.connectionController.ensureConnected();
  }

  private invalidateConnectionWork(): void {
    this.connectionController.invalidate();
  }

  async startNewThread(): Promise<void> {
    if (this.turnBusy) return;

    this.threadIdentity.clearActiveThreadContext();
    this.chatState.dispatch({ type: "ui/panel-set", panel: null });
    this.setStatus("New chat.");
    this.messageScroll.forceBottom();
    this.render();
    this.focusComposer();
  }

  private async refreshThreads(): Promise<void> {
    await this.connectionController.refreshThreads();
  }

  private async refreshDiagnostics(): Promise<void> {
    await this.connectionController.refreshDiagnostics();
  }

  private async refreshStatusPanel(): Promise<void> {
    await this.connectionController.refreshStatusPanel();
  }

  private async refreshSkills(forceReload = false): Promise<void> {
    await this.connectionController.refreshSkills(forceReload);
  }

  private async resumeThread(threadId: string): Promise<void> {
    await this.threadResume.resumeThread(threadId);
  }

  private refreshTabHeader(): void {
    const leaf = this.leaf as WorkspaceLeaf & {
      updateHeader?: () => void;
      updateDisplay?: () => void;
    };
    if (typeof leaf.updateHeader === "function") {
      leaf.updateHeader();
    } else if (typeof leaf.updateDisplay === "function") {
      leaf.updateDisplay();
    }
  }

  private notifyActiveThreadIdentityChanged(): void {
    this.refreshTabHeader();
    this.requestWorkspaceLayoutSave();
  }

  private async loadSharedThreadList(): Promise<void> {
    const threads = await this.plugin.refreshThreadList(() => this.appServer.loadThreadList());
    this.appServer.applyThreadList(threads);
  }

  private publishAppServerMetadataSnapshot(): void {
    this.appServer.publishAppServerMetadataSnapshot();
  }

  private applyCachedSharedAppServerState(): void {
    const threads = this.plugin.cachedThreadList();
    if (threads) this.appServer.applyThreadList(threads);
    const metadata = this.plugin.cachedAppServerMetadata();
    if (metadata) this.appServer.applyAppServerMetadata(metadata);
  }

  private requestWorkspaceLayoutSave(): void {
    void this.app.workspace.requestSaveLayout();
  }

  private async submitComposerAction(): Promise<void> {
    await this.composerSubmission.submit();
  }

  private async setRequestedModelFromUi(model: string | null): Promise<void> {
    await this.runtimeSettings.setRequestedModelFromUi(model);
  }

  private async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    await this.runtimeSettings.setRequestedReasoningEffortFromUi(effort);
  }

  private systemItem(text: string): DisplayItem {
    return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
  }

  private addSystemMessage(text: string): void {
    this.controller.addSystemMessage(text);
    this.render();
  }

  private addStructuredSystemMessage(text: string, details: DisplayDetailSection[]): void {
    this.controller.addStructuredSystemMessage(text, details);
    this.render();
  }

  private addDedupedSystemMessage(text: string): void {
    this.controller.addDedupedSystemMessage(text);
    this.render();
  }

  private setStatus(status: string): void {
    this.dispatch({ type: "status/set", status });
  }

  private restoreThreadPlaceholder(restoredThread: Parameters<RestoredThreadController["restore"]>[0]): void {
    this.restoredThread.restore(restoredThread);
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
  }

  private async ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.restoredThread.ensureLoaded();
  }

  private isRestoredThreadPending(threadId: string): boolean {
    return this.restoredThread.isPending(threadId);
  }

  private scheduleDeferredRestoredThreadHydration(): void {
    this.restoredThread.scheduleHydration();
  }

  private clearDeferredRestoredThreadHydration(): void {
    this.restoredThread.clearHydration();
  }

  private scheduleDeferredAppServerWarmup(): void {
    this.appServerWarmup.schedule();
  }

  private activeThreadTitle(): string | null {
    return buildActiveThreadTitle(this.state);
  }

  private restoredThreadPlaceholder() {
    return this.restoredThread.placeholder();
  }

  private restoredThreadTitle(): string | null {
    return this.restoredThread.title();
  }

  private clearRestoredThreadLifecycle(): void {
    this.restoredThread.clear();
  }

  private composerPlaceholder(): string {
    return buildComposerPlaceholder(this.activeComposerThreadName());
  }

  private activeComposerThreadName(): string | null {
    return buildActiveComposerThreadName(this.state, this.restoredThreadPlaceholder());
  }

  private render(options: ChatViewRenderScheduleOptions = {}): void {
    this.renderController.render(options);
  }

  private renderShellSlots(): void {
    this.renderController.renderShellSlots();
  }

  private renderToolbar(toolbar: HTMLElement): void {
    const model = this.toolbarViewModel();

    renderToolbar(toolbar, model, {
      toggleHistory: () => {
        this.toolbarPanels.toggleHistory();
      },
      toggleAutoReview: () => void this.runtimeSettings.toggleAutoReview(),
      toggleStatusPanel: () => {
        this.toolbarPanels.toggleStatus();
      },
      togglePlan: () => void this.runtimeSettings.toggleCollaborationMode(),
      toggleFast: () => void this.runtimeSettings.toggleFastMode(),
      toggleRuntime: () => {
        this.toolbarPanels.toggleRuntime("model");
      },
      connect: () => void this.reconnectActions.reconnectFromToolbar(),
      refreshStatus: () => void this.refreshStatusPanel(),
      resumeThread: (threadId) => void this.threadSelection.selectThreadFromToolbar(threadId),
      startArchiveThread: (threadId) => {
        this.toolbarPanels.startArchive(threadId);
      },
      archiveThread: (threadId, saveMarkdown) => void this.toolbarPanels.archiveThread(threadId, saveMarkdown),
      startRenameThread: (threadId) => {
        this.threadRename.start(threadId);
      },
      updateRenameDraft: (threadId, value) => {
        this.threadRename.updateDraft(threadId, value);
      },
      saveRenameThread: (threadId, value) => void this.threadRename.save(threadId, value),
      cancelRenameThread: (threadId) => {
        this.threadRename.cancel(threadId);
      },
      autoNameThread: (threadId) => void this.threadRename.autoNameDraft(threadId),
    });
  }

  private toolbarViewModel(): ToolbarViewModel {
    return buildToolbarViewModel({
      state: this.state,
      snapshot: this.runtimeSnapshot(),
      connected: this.connection.isConnected(),
      turnBusy: this.turnBusy,
      vaultPath: this.plugin.vaultPath,
      configuredCommand: this.plugin.settings.codexPath,
      archiveConfirmThreadId: this.toolbarPanels.archiveConfirmId(),
      archiveExportEnabled: this.plugin.settings.archiveExportEnabled,
      ...runtimeToolbarChoices({
        state: this.state,
        snapshot: this.runtimeSnapshot(),
        setRequestedModel: (model) => void this.setRequestedModelFromUi(model),
        setRequestedReasoningEffort: (effort) => void this.setRequestedReasoningEffortFromUi(effort),
      }),
      renameState: (threadId) => this.threadRename.editState(threadId),
    });
  }

  private async selectThread(threadId: string): Promise<void> {
    await this.threadSelection.selectThread(threadId);
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.toolbarPanels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.containerEl.doc.defaultView,
      contains: (element) => this.containerEl.contains(element),
      renameEditing: this.threadRename.isEditing(),
    });
  }

  private scheduleRender(options: ChatViewRenderScheduleOptions = {}): void {
    this.deferredTasks.scheduleRender((renderOptions) => {
      this.render(renderOptions);
    }, options);
  }

  private scheduleDeferredDiagnostics(): void {
    this.deferredTasks.scheduleDiagnostics(() => {
      void this.refreshDeferredDiagnostics();
    });
  }

  private clearDeferredDiagnostics(): void {
    this.deferredTasks.clearDiagnostics();
  }

  private async refreshDeferredDiagnostics(): Promise<void> {
    if (!this.connection.isConnected()) return;
    await this.appServer.refreshPublishedCapabilityDiagnostics({ cachedAppServerMetadata: true });
    this.render();
  }

  private panelRoot(): HTMLElement | null {
    return (this.containerEl.children[1] as HTMLElement | undefined) ?? null;
  }

  private statusSummaryLines(): string[] {
    return buildStatusSummaryLines(this.state, this.runtimeSnapshot());
  }

  private modelStatusLines(): string[] {
    return buildModelStatusLines(this.state, this.runtimeSnapshot(), this.collaborationModeLabel());
  }

  private effortStatusLines(): string[] {
    return buildEffortStatusLines(this.state, this.runtimeSnapshot());
  }

  private connectionDiagnosticSections() {
    return connectionDiagnosticsModel({
      state: this.state,
      connected: this.connection.isConnected(),
      configuredCommand: this.plugin.settings.codexPath,
    });
  }

  private connectionDiagnosticDetails(): DisplayDetailSection[] {
    return this.connectionDiagnosticSections().map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private async mcpStatusLines(): Promise<string[]> {
    return this.appServer.mcpStatusLines();
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.requestedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return this.runtimeSnapshotForState(this.state);
  }

  private runtimeSnapshotForState(state: ChatState): RuntimeSnapshot {
    return runtimeSnapshotForChatState({ state });
  }

  private renderMessages(parent: HTMLElement): void {
    this.messageRenderer.render(parent);
  }

  private pendingRequestsSignature(): string {
    return requestStateSignature(this.state.approvals, this.state.pendingUserInputs, this.state.userInputDrafts);
  }

  private renderComposer(parent: HTMLElement): void {
    this.composerController.render(parent);
  }
}
