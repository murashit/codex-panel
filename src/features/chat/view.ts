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
import { renderToolbar, type ToolbarViewModel } from "./ui/toolbar";
import { renderChatPanelShell, unmountChatPanelShell } from "./ui/shell";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { ChatMessageRenderer } from "./chat-message-renderer";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import { ChatThreadActionController } from "./thread-actions";
import { ChatRuntimeSettingsController } from "./runtime-settings-controller";
import { RestoredThreadController } from "./restored-thread-controller";
import { unmountReactRoot } from "../../shared/ui/react-root";
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
import {
  composerSlotSnapshot,
  latestProposedPlanItem,
  messagesSlotSnapshot,
  openPanelTurnLifecycle,
  parseRestoredThreadState,
  toolbarSlotSnapshot,
} from "./view-snapshot";
import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  type ChatViewRenderScheduleOptions,
} from "./view-lifecycle";
import { PendingRequestController } from "./pending-request-controller";
import { ToolbarPanelController } from "./toolbar-panel-controller";
import { ChatReconnectController } from "./reconnect-controller";
import { ChatMessageScrollController } from "./message-scroll-controller";
import { TurnSubmissionController } from "./turn-submission-controller";
import { SlashCommandController } from "./slash-command-controller";
import { ComposerSubmissionController } from "./composer-submission-controller";
import { ChatConnectionController } from "./connection-controller";
import { ThreadIdentityController } from "./thread-identity-controller";
import { ThreadResumeController } from "./thread-resume-controller";

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
  private readonly composerController: ChatComposerController;
  private readonly messageRenderer: ChatMessageRenderer;
  private readonly messageScroll: ChatMessageScrollController;
  private readonly turnSubmission: TurnSubmissionController;
  private readonly slashCommands: SlashCommandController;
  private readonly composerSubmission: ComposerSubmissionController;
  private shellRenderVersion = 0;
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
    this.turnSubmission = new TurnSubmissionController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.client,
      ensureRestoredThreadLoaded: () => this.ensureRestoredThreadLoaded(),
      startThread: () => this.appServer.startThread(),
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      resetThreadTurnPresence: (hadTurns) => {
        this.threadRename.resetThreadTurnPresence(hadTurns);
      },
      applyPendingThreadSettings: () => this.runtimeSettings.applyPendingThreadSettings(),
      codexInput: (text) => this.composerController.codexInput(text),
      setDraft: (text, options) => {
        this.composerController.setDraft(text, options);
      },
      forceMessagesToBottom: () => {
        this.messageScroll.forceBottom();
      },
      render: () => {
        this.render();
      },
      scheduleRender: () => {
        this.scheduleRender();
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
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
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        this.addStructuredSystemMessage(text, details);
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
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
      implementPlan: (item) => void this.implementPlan(item),
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
      renderIfDetached: () => {
        this.render();
      },
      onDraftChange: () => {
        this.plugin.refreshThreadsViewLiveState();
      },
      onComposerResize: () => {
        if (this.state.messagesPinnedToBottom) this.messageScroll.forceBottom();
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
      ensureConnected: () => this.ensureConnected(),
      setStatus: (status) => {
        this.setStatus(status);
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
    });
    this.connection = new ConnectionManager(() => this.plugin.settings.codexPath, this.plugin.vaultPath, {
      onNotification: (notification) => {
        this.controller.handleNotification(notification);
        this.plugin.refreshThreadsViewLiveState();
        this.scheduleRender();
      },
      onServerRequest: (request) => {
        this.controller.handleServerRequest(request);
        this.plugin.refreshThreadsViewLiveState();
        this.render();
      },
      onLog: (message) => {
        this.controller.handleAppServerLog(message);
        this.render();
      },
      onExit: () => {
        this.invalidateConnectionWork();
        this.invalidateResumeWork();
        this.setStatus("Codex app-server stopped.");
        this.chatState.dispatch({ type: "connection/scoped-cleared" });
        this.threadRename.resetThreadTurnPresence(false);
        this.client = null;
        this.plugin.refreshThreadsViewLiveState();
        this.render();
      },
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
        this.scheduleRender();
      },
      respondToServerRequest: (requestId, result) => this.respondToServerRequest(requestId, result),
      rejectServerRequest: (requestId, code, message) => this.rejectServerRequest(requestId, code, message),
    });
    this.pendingRequests = new PendingRequestController({
      stateStore: this.chatState,
      controller: this.controller,
      composerHasFocus: () => this.composerController.hasFocus(),
      refreshLiveState: () => {
        this.plugin.refreshThreadsViewLiveState();
      },
      render: () => {
        this.render();
      },
    });
    this.appServer = new ChatAppServerController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.connection.currentClient(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
      forceMessagesToBottom: () => {
        this.messageScroll.forceBottom();
      },
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
      loadSharedThreadList: () => this.loadSharedThreadList(),
      scheduleDeferredDiagnostics: () => {
        this.scheduleDeferredDiagnostics();
      },
      clearDeferredDiagnostics: () => {
        this.clearDeferredDiagnostics();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      render: () => {
        this.render();
      },
      scheduleRender: () => {
        this.scheduleRender();
      },
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    });
    this.history = new ThreadHistoryLoader({
      stateStore: this.chatState,
      currentClient: () => this.client,
      render: () => {
        this.render();
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      forceMessagesToBottom: () => {
        this.messageScroll.forceBottom();
      },
      keepCurrentScrollPosition: () => {
        this.messageScroll.preservePosition();
      },
      setThreadTurnPresence: (hadTurns) => {
        this.threadRename.resetThreadTurnPresence(hadTurns);
      },
    });
    this.threadActions = new ChatThreadActionController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      archiveAdapter: () => this.app.vault.adapter,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.client,
      history: this.history,
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      setComposerText: (text) => {
        this.setComposerText(text);
      },
      openThreadInNewView: (threadId) => this.plugin.openThreadInNewView(threadId),
      notifyThreadArchived: (threadId) => {
        this.plugin.notifyThreadArchived(threadId);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      refreshThreads: () => this.refreshThreads(),
      refreshSharedThreadListFromOpenSurface: () => {
        this.plugin.refreshSharedThreadListFromOpenSurface();
      },
    });
    this.toolbarPanels = new ToolbarPanelController({
      stateStore: this.chatState,
      threadActions: this.threadActions,
      scheduleRender: (options) => {
        this.scheduleRender(options);
      },
    });
    this.reconnectActions = new ChatReconnectController({
      stateStore: this.chatState,
      activeThreadId: () => this.state.activeThreadId,
      invalidateConnectionWork: () => {
        this.invalidateConnectionWork();
      },
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      clearDeferredDiagnostics: () => {
        this.clearDeferredDiagnostics();
      },
      reconnect: () => {
        this.connection.reconnect();
      },
      clearClient: () => {
        this.client = null;
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      render: () => {
        this.render();
      },
      ensureConnected: () => this.ensureConnected(),
      resumeThread: (threadId) => this.resumeThread(threadId),
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
    });
    this.runtimeSettings = new ChatRuntimeSettingsController({
      stateStore: this.chatState,
      currentClient: () => this.client,
      runtimeSnapshot: () => this.runtimeSnapshot(),
      collaborationModeLabel: () => this.collaborationModeLabel(),
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
    });
    this.restoredThread = new RestoredThreadController({
      deferredTasks: this.deferredTasks,
      opened: () => this.opened,
      resumeThread: (threadId) => this.resumeThread(threadId),
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      dispatch: (action) => {
        this.dispatch(action);
      },
      systemItem: (text) => this.systemItem(text),
      setStatus: (status) => {
        this.setStatus(status);
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
    });
    this.threadResume = new ThreadResumeController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      resumeWork: this.resumeWork,
      history: this.history,
      restoredThread: this.restoredThread,
      currentClient: () => this.client,
      ensureConnected: () => this.ensureConnected(),
      closing: () => this.closing,
      systemItem: (text) => this.systemItem(text),
      resetThreadTurnPresence: (hadTurns) => {
        this.threadRename.resetThreadTurnPresence(hadTurns);
      },
      clearDeferredRestoredThreadHydration: () => {
        this.clearDeferredRestoredThreadHydration();
      },
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      forceMessagesToBottom: () => {
        this.messageScroll.forceBottom();
      },
      render: () => {
        this.render();
      },
      refreshLiveState: () => {
        this.plugin.refreshThreadsViewLiveState();
      },
    });
    this.threadIdentity = new ThreadIdentityController({
      stateStore: this.chatState,
      restoredThread: this.restoredThread,
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      clearDeferredRestoredThreadHydration: () => {
        this.clearDeferredRestoredThreadHydration();
      },
      resetThreadTurnPresence: (hadTurns) => {
        this.threadRename.resetThreadTurnPresence(hadTurns);
      },
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      refreshLiveState: () => {
        this.plugin.refreshThreadsViewLiveState();
      },
      render: () => {
        this.render();
      },
    });
    this.threadRename = new ThreadRenameController({
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.connection.currentClient(),
      refreshThreads: () => this.refreshThreads(),
      render: () => {
        this.renderShellSlots();
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
    });
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
    const restoredThread = parseRestoredThreadState(state);
    if (!restoredThread) {
      this.invalidateResumeWork();
      this.clearRestoredThreadLifecycle();
      this.clearDeferredRestoredThreadHydration();
      this.scheduleDeferredAppServerWarmup();
      return;
    }

    this.restoreThreadPlaceholder(restoredThread);
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
    this.opened = true;
    this.closing = false;
    this.composerController.registerNoteIndexInvalidation((eventRef) => {
      this.registerEvent(eventRef);
    });
    this.registerDomEvent(this.containerEl.doc, "pointerdown", (event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.messageScroll.scrollToBottomOnFocus();
      }),
    );
    this.applyCachedSharedAppServerState();
    this.render();
    this.scheduleDeferredAppServerWarmup();
    this.scheduleDeferredRestoredThreadHydration();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    this.closing = true;
    this.invalidateConnectionWork();
    this.invalidateResumeWork();
    this.deferredTasks.clearAll();
    const panelRoot = this.panelRoot();
    unmountReactRoot(panelRoot?.querySelector<HTMLElement>(".codex-panel__toolbar") ?? null);
    this.messageRenderer.dispose();
    this.composerController.dispose();
    unmountReactRoot(panelRoot?.querySelector<HTMLElement>(".codex-panel__slot--composer") ?? null);
    unmountChatPanelShell(panelRoot);
    this.connection.disconnect();
    this.client = null;
    this.plugin.refreshThreadsViewLiveState();
    this.containerEl.win.setTimeout(() => {
      this.plugin.refreshThreadsViewLiveState();
    }, 0);
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

  private async implementPlan(item: DisplayItem): Promise<void> {
    if (!this.canImplementPlanItem(item)) return;
    await this.ensureConnected();
    if (!this.client || !this.state.activeThreadId) return;

    this.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
    this.dispatch({ type: "ui/panel-set", panel: null });
    await this.turnSubmission.sendTurnText("Please implement this plan.");
  }

  private async submitComposerAction(): Promise<void> {
    await this.composerSubmission.submit();
  }

  private canImplementPlanItem(item: DisplayItem): boolean {
    if (item.kind !== "message" || item.role !== "assistant" || item.proposedPlan !== true) return false;
    if (!this.state.activeThreadId || this.turnBusy || this.state.composerDraft.trim().length > 0) return false;
    if (this.state.requestedCollaborationMode !== "plan") return false;
    return latestProposedPlanItem(this.state.displayItems)?.id === item.id;
  }

  private async setRequestedModelFromUi(model: string | null): Promise<void> {
    await this.runtimeSettings.setRequestedModelFromUi(model);
  }

  private async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    await this.runtimeSettings.setRequestedReasoningEffortFromUi(effort);
  }

  private respondToServerRequest(requestId: Parameters<AppServerClient["respondToServerRequest"]>[0], result: unknown): boolean {
    try {
      this.client?.respondToServerRequest(requestId, result);
      return Boolean(this.client);
    } catch {
      return false;
    }
  }

  private rejectServerRequest(requestId: Parameters<AppServerClient["rejectServerRequest"]>[0], code: number, message: string): boolean {
    try {
      this.client?.rejectServerRequest(requestId, code, message);
      return Boolean(this.client);
    } catch {
      return false;
    }
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
    if (!this.opened || this.connection.isConnected()) return;
    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!this.opened || this.closing || this.connection.isConnected()) return;
      void this.ensureConnected();
    });
  }

  private clearDeferredAppServerWarmup(): void {
    this.deferredTasks.clearAppServerWarmup();
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

  private readonly renderToolbarSlot = (toolbar: HTMLElement): void => {
    this.renderToolbar(toolbar);
  };

  private readonly renderMessagesSlot = (parent: HTMLElement): void => {
    this.renderMessages(parent);
  };

  private readonly renderComposerSlot = (parent: HTMLElement): void => {
    this.renderComposer(parent);
  };

  private readonly toolbarSnapshot = (state: ChatState) => toolbarSlotSnapshot(state, this.connection.isConnected());

  private readonly messagesSnapshot = (state: ChatState) => messagesSlotSnapshot(state, this.pendingRequestsSignature());

  private readonly composerSnapshot = (state: ChatState) => composerSlotSnapshot(state, this.activeComposerThreadName());

  private render(options: ChatViewRenderScheduleOptions = {}): void {
    this.deferredTasks.clearRender();
    const root = this.panelRoot();
    if (!root) return;
    if (options.forceSlots) this.shellRenderVersion += 1;
    renderChatPanelShell(root, {
      stateStore: this.chatState,
      renderVersion: this.shellRenderVersion,
      toolbar: { render: this.renderToolbarSlot, snapshot: this.toolbarSnapshot },
      messages: { render: this.renderMessagesSlot, snapshot: this.messagesSnapshot },
      composer: { render: this.renderComposerSlot, snapshot: this.composerSnapshot },
    });
  }

  private renderShellSlots(): void {
    this.render({ forceSlots: true });
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
      resumeThread: (threadId) => {
        if (this.turnBusy && threadId !== this.state.activeThreadId) return;
        this.dispatch({ type: "ui/panel-set", panel: null });
        void this.selectThread(threadId);
      },
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
    if (this.turnBusy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    this.toolbarPanels.closeForThreadSelection();
    if (await this.plugin.focusThreadInOpenView(threadId)) return;
    await this.resumeThread(threadId);
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
