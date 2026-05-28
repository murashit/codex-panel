import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager, StaleConnectionError } from "../../app-server/connection-manager";
import type { SlashCommandName } from "./composer/slash-commands";
import { parseSlashCommand } from "./composer/suggestions";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import { createSystemItem } from "./display/system";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { Model } from "../../generated/app-server/v2/Model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../runtime/collaboration-mode";
import { ChatController } from "./chat-controller";
import { currentModel, type RuntimeSnapshot } from "../../runtime/state";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult } from "./slash-commands";
import type { ThreadReferenceInput } from "./slash-commands";
import { ChatAppServerController } from "./chat-app-server-controller";
import { ThreadHistoryLoader } from "./thread-history";
import { ThreadRenameController } from "./thread-rename";
import { pendingRequestsSignature as requestStateSignature } from "./request-state";
import type { CodexPanelSettings } from "../../settings/model";
import { ChatComposerController } from "./chat-composer-controller";
import {
  activeTurnId,
  chatTurnBusy,
  createChatStateStore,
  pendingTurnStart as pendingTurnStartForState,
  type ChatAction,
  type ChatState,
} from "./chat-state";
import { codexPanelDisplayTitle, explicitThreadName, getThreadTitle } from "../../domain/threads/model";
import {
  referencedThreadDisplay,
  referencedThreadPrompt,
  referencedThreadStatus,
  referencedThreadTurns,
  REFERENCED_THREAD_TURN_LIMIT,
  type ReferencedThreadDisplay,
} from "../../domain/threads/reference";
import { renderToolbar, type ToolbarViewModel } from "./ui/toolbar";
import { renderChatPanelShell, unmountChatPanelShell } from "./ui/shell";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { ChatMessageRenderer, type ChatMessageScrollIntent } from "./chat-message-renderer";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import { ChatThreadActionController } from "./thread-actions";
import { ChatRuntimeSettingsController } from "./runtime-settings-controller";
import { RestoredThreadController } from "./restored-thread-controller";
import { unmountReactRoot } from "../../shared/ui/react-root";
import {
  connectionDiagnosticsModel,
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
  type ActiveChatConnection,
  type ActiveChatResume,
  type ChatViewRenderScheduleOptions,
} from "./view-lifecycle";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./turn-submission";
import { resumedThreadAction, type ResumedThreadActionParams } from "./thread-resume";
import { PendingRequestController } from "./pending-request-controller";

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
  private readonly history: ThreadHistoryLoader;
  private readonly threadActions: ChatThreadActionController;
  private readonly runtimeSettings: ChatRuntimeSettingsController;
  private readonly restoredThread: RestoredThreadController;
  private readonly threadRename: ThreadRenameController;
  private readonly pendingRequests: PendingRequestController;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly composerController: ChatComposerController;
  private readonly messageRenderer: ChatMessageRenderer;
  private shellRenderVersion = 0;
  private archiveConfirmThreadId: string | null = null;
  private readonly connectionWork = new ChatConnectionWorkTracker();
  private readonly resumeWork: ChatResumeWorkTracker;
  private opened = false;
  private closing = false;
  private nextMessageScrollIntent: ChatMessageScrollIntent = "auto";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexChatHost,
  ) {
    super(leaf);
    this.deferredTasks = new ChatViewDeferredTasks(() => this.containerEl.win);
    this.resumeWork = new ChatResumeWorkTracker(() => {
      this.history.invalidate();
    });
    this.messageRenderer = new ChatMessageRenderer({
      app: this.app,
      owner: this,
      stateStore: this.chatState,
      vaultPath: this.plugin.vaultPath,
      consumeScrollIntent: () => {
        const value = this.nextMessageScrollIntent;
        this.nextMessageScrollIntent = "auto";
        return value;
      },
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
        if (this.state.messagesPinnedToBottom) this.queueMessagesBottomScroll();
      },
      onSubmit: () => void this.submitComposerAction(),
      onNewThread: () => void this.startNewThread(),
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
        this.queueMessagesBottomScroll();
      },
      publishAppServerMetadata: (metadata) => {
        this.plugin.publishAppServerMetadata(metadata);
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
        this.queueMessagesBottomScroll();
      },
      keepCurrentScrollPosition: () => {
        this.preserveMessagesScrollPosition();
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

  private get pendingTurnStart(): ReturnType<typeof pendingTurnStartForState> {
    return pendingTurnStartForState(this.state);
  }

  private dispatch(action: ChatAction): void {
    this.chatState.dispatch(action);
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  override getDisplayText(): string {
    return codexPanelDisplayTitle(this.state.activeThreadId, this.state.listedThreads, this.restoredThreadTitle());
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
    this.scrollMessagesToBottomOnFocus();
    this.focusComposer();
  }

  focusComposer(): void {
    this.composerController.focus();
  }

  notifyThreadArchived(threadId: string): void {
    if (this.clearArchivedActiveThread(threadId)) {
      this.render();
    }
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    let changed = false;
    const listedThreads = this.state.listedThreads.map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return { ...thread, name };
    });
    this.dispatch({ type: "thread/list-applied", threads: listedThreads });
    const restoredThread = this.restoredThreadPlaceholder();
    if (restoredThread?.threadId === threadId && (restoredThread.title !== name || restoredThread.explicitName !== name)) {
      this.restoredThread.rename(threadId, name);
      changed = true;
    }
    const activeThreadChanged = this.state.activeThreadId === threadId || this.isRestoredThreadPending(threadId);
    if (!changed && !activeThreadChanged) return;
    if (activeThreadChanged) {
      this.notifyActiveThreadIdentityChanged();
    } else {
      this.refreshTabHeader();
    }
    this.render();
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
        if (leaf === this.leaf) this.scrollMessagesToBottomOnFocus();
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
    const connecting = this.connectionWork.active();
    if (connecting?.promise) return connecting.promise;

    if (this.connection.isConnected()) {
      this.client = this.connection.currentClient();
      return;
    }

    const connection = this.connectionWork.begin();
    const promise = this.initializeConnection(connection);
    connection.promise = promise;
    try {
      await promise;
    } finally {
      this.connectionWork.finish(connection, promise);
    }
  }

  private async initializeConnection(connection: ActiveChatConnection): Promise<void> {
    this.setStatus("Starting Codex app-server...");
    try {
      this.dispatch({ type: "connection/initialized", initializeResponse: await this.connection.connect() });
      if (this.connectionWork.isStale(connection)) return;
      this.client = this.connection.currentClient();
      if (!this.client) throw new Error("Codex app-server connection did not initialize.");
      await this.appServer.refreshPublishedAppServerMetadata();
      if (this.connectionWork.isStale(connection)) return;
      await this.loadSharedThreadList();
      if (this.connectionWork.isStale(connection)) return;
      this.scheduleDeferredDiagnostics();
      this.refreshTabHeader();
      this.setStatus("Connected.");
    } catch (error) {
      if (this.connectionWork.isStale(connection)) return;
      if (error instanceof StaleConnectionError) return;
      this.setStatus("Connection failed.");
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      new Notice("Codex app-server connection failed.");
    }
    if (!this.connectionWork.isStale(connection)) {
      this.scheduleRender();
    }
  }

  private invalidateConnectionWork(): void {
    this.connectionWork.invalidate();
  }

  async startNewThread(): Promise<void> {
    if (this.turnBusy) return;

    this.clearActiveThreadContext();
    this.chatState.dispatch({ type: "ui/panel-set", panel: null });
    this.setStatus("New chat.");
    this.queueMessagesBottomScroll();
    this.render();
    this.focusComposer();
  }

  private async refreshThreads(): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    try {
      await this.loadSharedThreadList();
      await this.appServer.refreshPublishedAppServerMetadata();
      this.refreshTabHeader();
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    this.clearDeferredDiagnostics();
    await this.ensureConnected();
    if (!this.client) return;
    this.clearDeferredDiagnostics();
    await this.appServer.refreshPublishedCapabilityDiagnostics();
    this.render();
  }

  private async refreshStatusPanel(): Promise<void> {
    try {
      await this.refreshDiagnostics();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    await this.refreshThreads();
  }

  private async refreshSkills(forceReload = false): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    await this.appServer.refreshPublishedSkills(forceReload);
    this.render();
  }

  private async resumeThread(threadId: string): Promise<void> {
    if (this.turnBusy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    const resume = this.beginResumeWork(threadId);
    await this.ensureConnected();
    if (!this.client || this.isStaleResumeWork(resume)) return;

    try {
      const response = await this.client.resumeThread(threadId, this.plugin.vaultPath);
      if (this.isStaleResumeWork(resume)) return;
      this.applyResumedThread(response);
      await this.history.loadLatest(response.thread.id);
      if (this.isStaleResumeWork(resume)) return;
      if (this.state.displayItems.length === 0) {
        this.addSystemMessage(`Resumed thread ${response.thread.id}`);
        this.queueMessagesBottomScroll();
        this.render();
      }
      this.plugin.refreshThreadsViewLiveState();
    } catch (error) {
      if (this.isStaleResumeWork(resume)) return;
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
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

  private applyResumedThread(response: ResumedThreadActionParams["response"]): void {
    this.dispatch(
      resumedThreadAction({ response, listedThreads: this.state.listedThreads, displayItems: [this.systemItem("Loading thread...")] }),
    );
    this.clearRestoredThreadLifecycle();
    this.clearDeferredRestoredThreadHydration();
    this.threadRename.resetThreadTurnPresence(false);
    this.notifyActiveThreadIdentityChanged();
    this.render();
    this.plugin.refreshThreadsViewLiveState();
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

  private async sendMessage(): Promise<void> {
    const text = this.composerController.trimmedDraft;
    if (!text) return;

    await this.ensureConnected();
    if (!this.client) return;

    const slashCommand = parseSlashCommand(text);
    if (slashCommand) {
      this.composerController.setDraft("", { clearSuggestions: true });
      const result = await this.executeSlashCommand(slashCommand.command, slashCommand.args);
      if (result?.sendText) {
        await this.sendTurnText(result.sendText, result.sendInput, result.referencedThread);
      }
      return;
    }

    await this.sendTurnText(text);
  }

  private async sendTurnText(text: string, codexInputOverride?: UserInput[], referencedThread?: ReferencedThreadDisplay): Promise<void> {
    if (!(await this.ensureRestoredThreadLoaded())) return;
    const client = this.client;
    if (!client) return;

    if (this.turnBusy) {
      await this.steerCurrentTurn(text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!this.state.activeThreadId) {
        const threadResponse = await this.appServer.startThread();
        if (!threadResponse) return;
        this.notifyActiveThreadIdentityChanged();
        this.threadRename.resetThreadTurnPresence(false);
      }
      const activeThreadId = this.state.activeThreadId;
      if (!activeThreadId) return;
      if (!(await this.runtimeSettings.applyPendingThreadSettings())) return;

      const codexInput = codexInputOverride ?? this.composerController.codexInput(text);
      optimisticUserId = `local-user-${String(Date.now())}`;
      const optimistic = optimisticTurnStart({
        id: optimisticUserId,
        text,
        codexInput,
        referencedThread,
      });
      this.dispatch({
        type: "turn/optimistic-started",
        item: optimistic.item,
        pendingTurnStart: optimistic.pendingTurnStart,
      });
      this.queueMessagesBottomScroll();
      this.composerController.setDraft("");
      this.render();

      const response = await client.startTurn(activeThreadId, this.plugin.vaultPath, codexInput);
      const pendingTurnStart = this.pendingTurnStart;
      if (
        shouldAcknowledgeTurnStart({
          pendingTurnStart,
          activeTurnId: this.activeTurnId,
          optimisticUserId,
          responseTurnId: response.turn.id,
        })
      ) {
        const displayItems = acknowledgeOptimisticTurnStart({
          items: this.state.displayItems,
          optimisticUserId,
          turnId: response.turn.id,
          pendingTurnStart,
        });
        this.dispatch({ type: "turn/start-acknowledged", turnId: response.turn.id, displayItems });
        this.setStatus("Turn running...");
      }
    } catch (error) {
      const displayItems = cleanupFailedTurnStart({
        items: this.state.displayItems,
        optimisticUserId,
        pendingTurnStart: this.pendingTurnStart,
      });
      this.dispatch({ type: "turn/start-failed", displayItems });
      this.composerController.setDraft(text);
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    this.scheduleRender();
  }

  private async steerCurrentTurn(
    text: string,
    codexInputOverride?: UserInput[],
    referencedThread?: ReferencedThreadDisplay,
  ): Promise<void> {
    if (!this.client || !this.state.activeThreadId || !this.activeTurnId) {
      this.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const threadId = this.state.activeThreadId;
    const expectedTurnId = this.activeTurnId;
    const codexInput = codexInputOverride ?? this.composerController.codexInput(text);

    this.composerController.setDraft("", { clearSuggestions: true });

    try {
      await this.client.steerTurn(threadId, expectedTurnId, codexInput);
      this.dispatch({
        type: "system/message-added",
        item: localUserMessageItemFromInput({
          id: `local-steer-${String(Date.now())}`,
          text,
          turnId: expectedTurnId,
          referencedThread,
          codexInput,
        }),
      });
      this.queueMessagesBottomScroll();
      this.setStatus("Steered current turn.");
    } catch (error) {
      this.composerController.setDraft(text, { focus: true });
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.scheduleRender();
  }

  private async implementPlan(item: DisplayItem): Promise<void> {
    if (!this.canImplementPlanItem(item)) return;
    await this.ensureConnected();
    if (!this.client || !this.state.activeThreadId) return;

    this.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
    this.dispatch({ type: "ui/panel-set", panel: null });
    await this.sendTurnText("Please implement this plan.");
  }

  private async interruptTurn(): Promise<void> {
    if (!this.client || !this.state.activeThreadId || !this.activeTurnId) return;
    try {
      await this.client.interruptTurn(this.state.activeThreadId, this.activeTurnId);
      this.setStatus("Interrupt requested.");
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async submitComposerAction(): Promise<void> {
    const draft = this.composerController.trimmedDraft;
    if (this.turnBusy && this.state.activeThreadId && this.activeTurnId && draft.length === 0) {
      await this.interruptTurn();
      return;
    }
    await this.sendMessage();
  }

  private async executeSlashCommand(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined> {
    if (!this.client) return;
    return runSlashCommand(command, args, {
      activeThreadId: this.state.activeThreadId,
      listedThreads: this.state.listedThreads,
      startNewThread: () => this.startNewThread(),
      resumeThread: (threadId) => this.selectThread(threadId),
      referThread: (thread, message) => this.referencedThreadInput(thread, message),
      forkThread: (threadId) => this.threadActions.forkThread(threadId),
      rollbackThread: (threadId) => this.threadActions.rollbackThread(threadId),
      compactThread: async (threadId) => {
        await this.client?.compactThread(threadId);
      },
      archiveThread: (threadId) => this.threadActions.archiveThread(threadId),
      busy: this.turnBusy,
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
  }

  private async referencedThreadInput(thread: Thread, message: string): Promise<ThreadReferenceInput | null> {
    if (!this.client) return null;
    try {
      const response = await this.client.threadTurnsList(thread.id, null, REFERENCED_THREAD_TURN_LIMIT);
      const turns = referencedThreadTurns(response.data);
      if (turns.length === 0) {
        this.addSystemMessage("Referenced thread has no readable conversation turns.");
        return null;
      }
      const prompt = referencedThreadPrompt(thread, turns, message);
      const messageInput = this.composerController.codexInput(message);
      this.setStatus(referencedThreadStatus(thread, turns.length));
      return {
        input: [{ type: "text", text: prompt, text_elements: [] }, ...messageInput.filter((item) => item.type !== "text")],
        referencedThread: referencedThreadDisplay(thread, turns.length),
      };
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private canImplementPlanItem(item: DisplayItem): boolean {
    if (item.kind !== "message" || item.role !== "assistant" || item.proposedPlan !== true) return false;
    if (!this.state.activeThreadId || this.turnBusy || this.state.composerDraft.trim().length > 0) return false;
    if (this.state.requestedCollaborationMode !== "plan") return false;
    return latestProposedPlanItem(this.state.displayItems)?.id === item.id;
  }

  private toggleRuntimePicker(picker: NonNullable<ChatState["runtimePicker"]>): void {
    this.dispatch({ type: "ui/panel-set", panel: picker, toggle: true });
    this.render();
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

  private beginResumeWork(threadId: string): ActiveChatResume {
    return this.resumeWork.begin(threadId);
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
  }

  private isStaleResumeWork(resume: ActiveChatResume): boolean {
    return this.resumeWork.isStale(resume) || this.closing;
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
    const threadId = this.state.activeThreadId;
    if (!threadId) return null;
    const thread = this.state.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
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
    const threadName = this.activeComposerThreadName();
    return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
  }

  private activeComposerThreadName(): string | null {
    const threadId = this.state.activeThreadId;
    if (!threadId) return null;
    const thread = this.state.listedThreads.find((item) => item.id === threadId);
    const listedName = thread ? explicitThreadName(thread) : null;
    if (listedName) return listedName;
    const restoredThread = this.restoredThreadPlaceholder();
    return restoredThread?.threadId === threadId ? restoredThread.explicitName : null;
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
        this.toggleHistoryPanel();
      },
      toggleAutoReview: () => void this.runtimeSettings.toggleAutoReview(),
      toggleStatusPanel: () => {
        this.toggleStatusPanel();
      },
      togglePlan: () => void this.runtimeSettings.toggleCollaborationMode(),
      toggleFast: () => void this.runtimeSettings.toggleFastMode(),
      toggleRuntime: () => {
        this.toggleRuntimePicker("model");
      },
      connect: () => void this.reconnectFromToolbar(),
      refreshStatus: () => void this.refreshStatusPanel(),
      resumeThread: (threadId) => {
        if (this.turnBusy && threadId !== this.state.activeThreadId) return;
        this.dispatch({ type: "ui/panel-set", panel: null });
        void this.selectThread(threadId);
      },
      startArchiveThread: (threadId) => {
        this.startArchiveThread(threadId);
      },
      archiveThread: (threadId, saveMarkdown) => void this.archiveThread(threadId, saveMarkdown),
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
      archiveConfirmThreadId: this.archiveConfirmThreadId,
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

  private async reconnectFromToolbar(): Promise<void> {
    const threadId = this.state.activeThreadId;
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.invalidateConnectionWork();
    this.invalidateResumeWork();
    this.clearDeferredDiagnostics();
    this.connection.reconnect();
    this.client = null;
    this.dispatch({ type: "turn/local-cleared" });
    this.setStatus("Reconnecting...");
    this.render();

    await this.ensureConnected();
    if (!threadId) return;
    try {
      await this.resumeThread(threadId);
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private toggleHistoryPanel(): void {
    this.dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
    this.scheduleRender();
  }

  private async selectThread(threadId: string): Promise<void> {
    if (this.turnBusy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    this.archiveConfirmThreadId = null;
    if (await this.plugin.focusThreadInOpenView(threadId)) return;
    await this.resumeThread(threadId);
  }

  private startArchiveThread(threadId: string): void {
    this.archiveConfirmThreadId = threadId;
    this.scheduleRender({ forceSlots: true });
  }

  private async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
    await this.threadActions.archiveThread(threadId, saveMarkdown);
    this.scheduleRender({ forceSlots: true });
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    if (!this.hasOpenToolbarPanel()) return;

    const target = event.target;
    const viewWindow = this.containerEl.doc.defaultView;
    if (viewWindow && target instanceof viewWindow.Element) {
      const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
      if (insideToolbarPanel && this.containerEl.contains(insideToolbarPanel)) {
        if (this.archiveConfirmThreadId && !target.closest(".codex-panel__archive-confirm")) {
          this.archiveConfirmThreadId = null;
          this.scheduleRender({ forceSlots: true });
        }
        return;
      }
    }

    if (this.archiveConfirmThreadId) {
      this.archiveConfirmThreadId = null;
      this.scheduleRender({ forceSlots: true });
    }

    if (this.threadRename.isEditing()) return;

    this.closeToolbarPanel();
  }

  private hasOpenToolbarPanel(): boolean {
    return this.state.openDetails.has("history") || this.state.openDetails.has("status-panel") || this.state.runtimePicker !== null;
  }

  private closeToolbarPanel(): void {
    if (!this.hasOpenToolbarPanel()) return;

    this.dispatch({ type: "ui/panel-set", panel: null });
    this.archiveConfirmThreadId = null;
    this.scheduleRender({ forceSlots: true });
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

  private toggleStatusPanel(): void {
    this.dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
    this.scheduleRender();
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

  private queueMessagesBottomScroll(): void {
    this.dispatch({ type: "ui/messages-pinned-set", pinned: true });
    this.nextMessageScrollIntent = "force-bottom";
  }

  private preserveMessagesScrollPosition(): void {
    this.nextMessageScrollIntent = "preserve";
  }

  private scrollMessagesToBottomOnFocus(): void {
    this.queueMessagesBottomScroll();
    this.render();
  }

  private clearActiveThreadContext(): void {
    this.invalidateResumeWork();
    this.clearRestoredThreadLifecycle();
    this.clearDeferredRestoredThreadHydration();
    this.chatState.dispatch({ type: "thread/active-cleared" });
    this.threadRename.resetThreadTurnPresence(false);
    this.notifyActiveThreadIdentityChanged();
    this.plugin.refreshThreadsViewLiveState();
  }

  private clearArchivedActiveThread(threadId: string): boolean {
    if (this.state.activeThreadId !== threadId) return false;
    this.clearActiveThreadContext();
    return true;
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
