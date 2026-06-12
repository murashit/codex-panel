import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import { collaborationModeLabel as formatCollaborationModeLabel, type RuntimeSnapshot } from "./runtime/model";
import { chatTurnBusy, createChatStateStore, type ChatState, type ChatAction } from "./state/reducer";
import type { OpenCodexPanelSnapshot } from "../../workspace/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../app-server/shared-cache-state";
import type { CodexChatHost } from "./chat-host";
import { createStructuredSystemItem, createSystemItem } from "./display/system";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "./display/runtime-status";
import { runtimeSnapshotForChatState } from "./runtime/snapshot";
import { activeThreadTitle as buildActiveThreadTitle, chatViewDisplayTitle } from "./panel/view-model/thread-title";
import { connectionDiagnosticsModel } from "./panel/view-model/toolbar";
import { openPanelTurnLifecycle } from "./panel/snapshot";
import { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./panel/lifecycle";
import { ChatMessageScrollIntentController } from "./panel/message-scroll-intent-controller";
import type { ChatControllerCompositionPorts } from "./panel/controller-ports";
import { createChatViewControllers, type ChatViewControllers } from "./panel/composition";
import type { ChatPanelComposerPorts, ChatPanelGoalPorts, ChatPanelStatePort, ChatPanelToolbarPorts } from "./panel/ui-ports";
import {
  chatPanelComposerMetaViewModel,
  chatPanelComposerPlaceholder,
  chatPanelPendingRequestsSignature,
} from "./panel/region-view-models";
import {
  chatPanelComposerRegionNode,
  chatPanelGoalRegionNode,
  chatPanelMessagesRegionNode,
  chatPanelToolbarRegionNode,
} from "./ui/regions";

type ChatPanelToolbarActions = ChatPanelToolbarPorts["actions"]["toolbar"];
type ChatPanelToolbarState = ChatPanelToolbarPorts["view"]["toolbar"];
type ChatPanelGoalActions = ChatPanelGoalPorts["actions"]["goal"];

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly controllers: ChatViewControllers;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly messageScrollIntent: ChatMessageScrollIntentController;
  private readonly toolbarPorts: ChatPanelToolbarPorts;
  private readonly goalPorts: ChatPanelGoalPorts;
  private readonly messagesPorts: ChatPanelStatePort;
  private readonly composerPorts: ChatPanelComposerPorts;
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
    this.resumeWork = new ChatResumeWorkTracker();
    this.messageScrollIntent = new ChatMessageScrollIntentController();
    this.controllers = createChatViewControllers(this.createControllerPorts());
    const panelPorts = this.createPanelRegionPorts(this.controllers);
    this.toolbarPorts = panelPorts.toolbar;
    this.goalPorts = panelPorts.goal;
    this.messagesPorts = panelPorts.messages;
    this.composerPorts = panelPorts.composer;
  }

  private createControllerPorts(): ChatControllerCompositionPorts {
    return {
      obsidian: {
        app: this.app,
        owner: this,
        viewId: this.viewId,
        registerEvent: (eventRef) => {
          this.registerEvent(eventRef);
        },
        registerPointerDown: (handler) => {
          this.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
        },
        archiveAdapter: () => this.app.vault.adapter,
      },
      plugin: {
        settings: this.plugin.settings,
        vaultPath: this.plugin.vaultPath,
        openThreadInNewView: (threadId) => this.plugin.openThreadInNewView(threadId),
        focusThreadInOpenView: (threadId) => this.plugin.focusThreadInOpenView(threadId),
        openTurnDiff: (state) => this.plugin.openTurnDiff(state),
        notifyThreadArchived: (threadId) => {
          this.plugin.notifyThreadArchived(threadId);
        },
        notifyThreadRenamed: (threadId, name) => {
          this.plugin.notifyThreadRenamed(threadId, name);
        },
        refreshThreadsViewLiveState: () => {
          this.plugin.refreshThreadsViewLiveState();
        },
        refreshSharedThreadListFromOpenSurface: () => {
          this.plugin.refreshSharedThreadListFromOpenSurface();
        },
        applyThreadListSnapshot: (threads) => {
          this.plugin.applyThreadListSnapshot(threads);
        },
        publishAppServerMetadata: (metadata) => {
          this.plugin.publishAppServerMetadata(metadata);
        },
        publishAppServerIdentity: (userAgent) => {
          this.plugin.publishAppServerIdentity(userAgent);
        },
        cachedThreadList: () => this.plugin.cachedThreadList(),
        cachedAppServerMetadata: () => this.plugin.cachedAppServerMetadata(),
      },
      state: {
        stateStore: this.chatState,
        getState: () => this.state,
        systemItem: (text) => this.systemItem(text),
        structuredSystemItem: (text, details) => this.structuredSystemItem(text, details),
      },
      client: {
        getClient: () => this.client,
        setClient: (client) => {
          this.client = client;
        },
        clear: () => {
          this.client = null;
        },
      },
      lifecycle: {
        deferredTasks: this.deferredTasks,
        resumeWork: this.resumeWork,
        connectionWork: this.connectionWork,
        messageScrollIntent: this.messageScrollIntent,
        getOpened: () => this.opened,
        setOpened: (opened) => {
          this.opened = opened;
        },
        getClosing: () => this.closing,
        setClosing: (closing) => {
          this.closing = closing;
        },
        invalidateConnectionWork: () => {
          this.connectionWork.invalidate();
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
      },
      render: {
        panelRoot: () => this.panelRoot(),
        toolbarNode: () => chatPanelToolbarRegionNode(this.toolbarPorts),
        goalNode: () => chatPanelGoalRegionNode(this.goalPorts),
        messagesNode: () => chatPanelMessagesRegionNode(() => this.controllers.render.messages.renderNode()),
        composerNode: () => chatPanelComposerRegionNode(() => this.controllers.composer.controller.renderNode()),
        closeToolbarPanelOnOutsidePointer: (event) => {
          this.closeToolbarPanelOnOutsidePointer(event);
        },
        schedule: () => {
          this.scheduleRender();
        },
      },
      messages: {
        pendingRequestsSignature: () => chatPanelPendingRequestsSignature(this.messagesPorts),
      },
      composerView: {
        composerPlaceholder: () => chatPanelComposerPlaceholder(this.composerPorts),
        composerMetaViewModel: () => chatPanelComposerMetaViewModel(this.composerPorts),
      },
      runtime: {
        runtimeSnapshotForState: (state) => this.runtimeSnapshotForState(state),
        collaborationModeLabel: () => this.collaborationModeLabel(),
        connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
        modelStatusLines: () => this.modelStatusLines(),
        effortStatusLines: () => this.effortStatusLines(),
        statusSummaryLines: () => this.statusSummaryLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: () => this.ensureRestoredThreadLoaded(),
        startNewThread: () => this.startNewThread(),
        loadSharedThreadList: () => this.loadSharedThreadList(),
        notifyIdentityChanged: () => {
          this.notifyActiveThreadIdentityChanged();
        },
        refreshTabHeader: () => {
          this.refreshTabHeader();
        },
      },
      liveState: {
        refresh: () => {
          this.plugin.refreshThreadsViewLiveState();
        },
        deferRefresh: () => {
          this.containerEl.win.setTimeout(() => {
            this.plugin.refreshThreadsViewLiveState();
          }, 0);
        },
      },
      scroll: {
        forceBottom: () => {
          this.messageScrollIntent.forceBottom();
        },
        followBottom: () => {
          this.messageScrollIntent.followBottom();
        },
        preservePosition: () => {
          this.messageScrollIntent.preservePosition();
        },
      },
      status: {
        set: (status) => {
          this.dispatch({ type: "connection/status-set", status });
        },
      },
    };
  }

  private createPanelRegionPorts(controllers: ChatViewControllers): {
    toolbar: ChatPanelToolbarPorts;
    goal: ChatPanelGoalPorts;
    messages: ChatPanelStatePort;
    composer: ChatPanelComposerPorts;
  } {
    const state = {
      chat: () => this.state,
    };
    return {
      toolbar: {
        state: {
          ...state,
          connected: () => controllers.connection.manager.isConnected(),
          turnBusy: () => this.turnBusy,
        },
        settings: {
          vaultPath: () => this.plugin.vaultPath,
          configuredCommand: () => this.plugin.settings.codexPath,
          archiveExportEnabled: () => this.plugin.settings.archiveExportEnabled,
        },
        runtime: {
          snapshot: () => this.runtimeSnapshot(),
        },
        view: {
          toolbar: this.createToolbarPanelState(controllers),
        },
        actions: {
          toolbar: this.createToolbarPanelActions(controllers),
        },
      },
      goal: {
        state,
        settings: {
          sendShortcut: () => this.plugin.settings.sendShortcut,
        },
        actions: {
          goal: this.createGoalPanelActions(controllers),
        },
      },
      messages: {
        state,
      },
      composer: {
        state,
        thread: {
          restoredPlaceholder: () => this.restoredThreadPlaceholder(),
        },
        runtime: {
          snapshot: () => this.runtimeSnapshot(),
          requestModel: (model) => this.requestModelFromUi(model),
          requestReasoningEffort: (effort) => this.requestReasoningEffortFromUi(effort),
          resetReasoningEffortToConfig: () => this.resetReasoningEffortToConfigFromUi(),
        },
      },
    };
  }

  private createToolbarPanelState(controllers: ChatViewControllers): ChatPanelToolbarState {
    return {
      archiveConfirmId: () => controllers.toolbar.panels.archiveConfirmId(),
      archiveConfirmSubscribe: (listener) => controllers.toolbar.panels.onArchiveConfirmChange(listener),
      renameState: (threadId) => controllers.thread.rename.editState(threadId),
      renameSubscribe: (listener) => controllers.thread.rename.subscribe(listener),
    };
  }

  private createToolbarPanelActions(controllers: ChatViewControllers): ChatPanelToolbarActions {
    return {
      startNewThread: () => {
        void this.startNewThread();
      },
      toggleChatActions: () => {
        controllers.toolbar.panels.toggleChatActions();
      },
      compactConversation: () => {
        void this.compactConversation();
      },
      setGoal: () => {
        this.setGoalEditingOpen(true, { closeToolbarPanel: true });
      },
      toggleHistory: () => {
        controllers.toolbar.panels.toggleHistory();
      },
      toggleStatusPanel: () => {
        controllers.toolbar.panels.toggleStatus();
      },
      connect: () => {
        void controllers.connection.reconnect.reconnectPanel();
      },
      refreshStatus: () => {
        void controllers.connection.controller.refreshStatusPanel();
      },
      resumeThread: (threadId) => {
        void controllers.thread.selection.selectThreadFromToolbar(threadId);
      },
      startArchiveThread: (threadId) => {
        controllers.toolbar.panels.startArchive(threadId);
      },
      archiveThread: (threadId, saveMarkdown) => {
        void controllers.toolbar.panels.archiveThread(threadId, saveMarkdown);
      },
      startRenameThread: (threadId) => {
        controllers.thread.rename.start(threadId);
      },
      updateRenameDraft: (threadId, value) => {
        controllers.thread.rename.updateDraft(threadId, value);
      },
      saveRenameThread: (threadId, value) => {
        void controllers.thread.rename.save(threadId, value);
      },
      cancelRenameThread: (threadId) => {
        controllers.thread.rename.cancel(threadId);
      },
      autoNameThread: (threadId) => {
        void controllers.thread.rename.autoNameDraft(threadId);
      },
    };
  }

  private createGoalPanelActions(controllers: ChatViewControllers): ChatPanelGoalActions {
    return {
      saveObjective: (objective, tokenBudget) => this.saveGoalObjective(objective, tokenBudget),
      setStatus: (threadId, status) => controllers.runtime.goals.setStatus(threadId, status),
      clear: (threadId) => controllers.runtime.goals.clear(threadId),
      setEditingOpen: (open) => {
        this.setGoalEditingOpen(open);
      },
    };
  }

  private async compactConversation(): Promise<void> {
    const threadId = this.state.activeThread.id;
    if (!threadId) {
      this.controllers.inbound.controller.addSystemMessage("No active thread to compact.");
      this.controllers.render.controller.render();
      return;
    }
    await this.controllers.thread.actions.compactThread(threadId);
  }

  private setGoalEditingOpen(open: boolean, { closeToolbarPanel = false }: { closeToolbarPanel?: boolean } = {}): void {
    if (closeToolbarPanel) this.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "ui/detail-open-set", key: "goal:editor", open });
    this.controllers.render.controller.render();
  }

  private async saveGoalObjective(objective: string, tokenBudget: number | null): Promise<void> {
    let threadId = this.state.activeThread.id;
    if (!threadId) {
      try {
        await this.controllers.connection.controller.ensureConnected();
        const response = await this.controllers.serverActions.threads.startThread(objective, { syncGoal: false });
        threadId = response?.threadId ?? null;
      } catch (error) {
        this.controllers.inbound.controller.addSystemMessage(error instanceof Error ? error.message : String(error));
        this.controllers.render.controller.render();
        return;
      }
    }
    if (!threadId) return;
    void this.controllers.runtime.goals.setObjective(threadId, objective, tokenBudget);
  }

  private get state(): ChatState {
    return this.chatState.getState();
  }

  private get turnBusy(): boolean {
    return chatTurnBusy(this.state);
  }

  private dispatch(action: ChatAction): void {
    this.chatState.dispatch(action);
  }

  private systemItem(text: string): DisplayItem {
    return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
  }

  private structuredSystemItem(text: string, details: DisplayDetailSection[]): DisplayItem {
    return createStructuredSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text, details);
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
    const threadId = this.state.activeThread.id;
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
    this.controllers.render.applyViewState(state);
  }

  refreshSettings(): void {
    this.controllers.render.controller.render();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.controllers.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
    this.controllers.render.controller.render();
  }

  applyAppServerMetadataSnapshot(metadata: SharedAppServerMetadata): void {
    this.controllers.serverActions.metadata.applyAppServerMetadata(metadata);
    this.controllers.render.controller.render();
  }

  applyAvailableModelsSnapshot(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
    this.controllers.render.controller.render();
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return {
      viewId: this.viewId,
      threadId: this.closing ? null : this.state.activeThread.id,
      lastFocused: false,
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingApprovals: this.state.requests.approvals.length,
      pendingUserInputs: this.state.requests.pendingUserInputs.length,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.controllers.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.controllers.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.isRestoredThreadPending(threadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  focusComposer(): void {
    this.controllers.composer.controller.focus();
  }

  notifyThreadArchived(threadId: string): void {
    this.controllers.thread.identity.notifyThreadArchived(threadId);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.controllers.thread.identity.notifyThreadRenamed(threadId, name);
  }

  override async onOpen(): Promise<void> {
    this.controllers.render.openView();
  }

  override async onClose(): Promise<void> {
    this.controllers.render.closeView();
  }

  setComposerText(text: string): void {
    this.controllers.composer.controller.setDraft(text, { focus: true });
    this.controllers.render.controller.render();
  }

  async connect(): Promise<void> {
    await this.controllers.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    if (this.turnBusy) return;

    this.controllers.thread.identity.clearActiveThreadContext();
    this.chatState.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "connection/status-set", status: "New chat." });
    this.controllers.render.controller.render();
    this.focusComposer();
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
    const threads = await this.plugin.refreshThreadList(() => this.controllers.serverActions.threads.loadThreadList());
    this.controllers.serverActions.threads.applyThreadList(threads);
  }

  private requestWorkspaceLayoutSave(): void {
    void this.app.workspace.requestSaveLayout();
  }

  private async requestModelFromUi(model: string): Promise<void> {
    await this.controllers.runtime.settings.requestModelFromUi(model);
  }

  private async requestReasoningEffortFromUi(effort: ReasoningEffort): Promise<void> {
    await this.controllers.runtime.settings.requestReasoningEffortFromUi(effort);
  }

  private async resetReasoningEffortToConfigFromUi(): Promise<void> {
    await this.controllers.runtime.settings.resetReasoningEffortToConfigFromUi();
  }

  private async ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.controllers.thread.restored.ensureLoaded();
  }

  private isRestoredThreadPending(threadId: string): boolean {
    return this.controllers.thread.restored.isPending(threadId);
  }

  private scheduleDeferredRestoredThreadHydration(): void {
    this.controllers.thread.restored.scheduleHydration();
  }

  private clearDeferredRestoredThreadHydration(): void {
    this.controllers.thread.restored.clearHydration();
  }

  private scheduleDeferredAppServerWarmup(): void {
    this.controllers.connection.scheduleWarmup();
  }

  private activeThreadTitle(): string | null {
    return buildActiveThreadTitle(this.state);
  }

  private restoredThreadPlaceholder() {
    return this.controllers.thread.restored.placeholder();
  }

  private restoredThreadTitle(): string | null {
    return this.controllers.thread.restored.title();
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.controllers.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.containerEl.doc.defaultView,
      contains: (element) => this.containerEl.contains(element),
      renameEditing: this.controllers.thread.rename.isEditing(),
    });
  }

  private scheduleRender(): void {
    this.deferredTasks.scheduleRender(() => {
      this.controllers.render.controller.render();
    });
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
    if (!this.controllers.connection.manager.isConnected()) return;
    await this.controllers.serverActions.diagnostics.refreshPublishedDiagnosticProbes({ cachedAppServerMetadata: true });
    this.controllers.render.controller.render();
  }

  private panelRoot(): HTMLElement | null {
    return this.contentEl;
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

  private connectionDiagnosticSections() {
    return connectionDiagnosticsModel({
      state: this.state,
      connected: this.controllers.connection.manager.isConnected(),
      configuredCommand: this.plugin.settings.codexPath,
    });
  }

  private connectionDiagnosticDetails(): DisplayDetailSection[] {
    return this.connectionDiagnosticSections().map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.runtime.selectedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return this.runtimeSnapshotForState(this.state);
  }

  private runtimeSnapshotForState(state: ChatState): RuntimeSnapshot {
    return runtimeSnapshotForChatState(state);
  }
}
