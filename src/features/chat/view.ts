import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/connection/client";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import type { RuntimeSnapshot } from "./runtime/snapshot";
import { collaborationModeLabel as formatCollaborationModeLabel } from "./runtime/pending-settings";
import { chatTurnBusy, createChatStateStore, type ChatAction, type ChatState } from "./state/reducer";
import type { OpenCodexPanelSnapshot } from "../../workspace/open-panel-snapshot";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { CodexChatHost } from "./chat-host";
import { createStructuredSystemItem, createSystemItem } from "./display/items/system";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "./display/status/runtime";
import { runtimeSnapshotForChatState } from "./runtime/snapshot";
import { codexPanelDisplayTitle, getThreadTitle } from "../../domain/threads/model";
import { connectionDiagnosticsModel } from "./panel/surface/toolbar";
import { openPanelTurnLifecycle } from "./panel/snapshot";
import { ChatConnectionWorkTracker, ChatResumeWorkTracker, createChatViewDeferredTasks, type ChatViewDeferredTasks } from "./lifecycle";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "./ui/message-stream/scroll-intent-state";
import type { ChatControllerPorts } from "./controller-ports";
import { createChatViewControllers, type ChatViewControllers } from "./controllers";
import type { ChatPanelSurfacePorts } from "./panel/surface/ports";
import { createChatPanelSurfacePorts } from "./panel/surface/create-ports";
import { chatPanelComposerMetaViewModel, chatPanelComposerPlaceholder } from "./panel/surface/composer";
import { pendingRequestsSignature as requestStateSignature } from "./conversation/pending-requests/signatures";

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly controllers: ChatViewControllers;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly messageScrollIntent: ChatMessageScrollIntentState;
  private readonly panelSurface: ChatPanelSurfacePorts;
  private readonly connectionWork = new ChatConnectionWorkTracker();
  private readonly resumeWork: ChatResumeWorkTracker;
  private opened = false;
  private closing = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexChatHost,
  ) {
    super(leaf);
    this.deferredTasks = createChatViewDeferredTasks(() => this.containerEl.win);
    this.resumeWork = new ChatResumeWorkTracker();
    this.messageScrollIntent = createChatMessageScrollIntentState();
    this.controllers = createChatViewControllers(this.createControllerPorts());
    this.panelSurface = createChatPanelSurfacePorts(
      {
        settings: this.plugin.settings,
        vaultPath: this.plugin.vaultPath,
        stateStore: this.chatState,
        restoredThreadPlaceholder: () => this.restoredThreadPlaceholder(),
        startNewThread: () => this.startNewThread(),
      },
      this.controllers,
    );
  }

  private createControllerPorts(): ChatControllerPorts {
    const refreshThreadsViewLiveState = () => {
      this.plugin.refreshThreadsViewLiveState();
    };

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
      plugin: this.plugin,
      state: {
        stateStore: this.chatState,
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
        refreshDeferredDiagnostics: () => this.refreshDeferredDiagnostics(),
      },
      render: {
        panelRoot: () => this.panelRoot(),
        shellParts: () => ({
          toolbar: this.panelSurface.toolbar,
          goal: this.panelSurface.goal,
          messageStream: this.controllers.render.messageStreamPresenter,
          composer: this.controllers.composer.controller,
        }),
        closeToolbarPanelOnOutsidePointer: (event) => {
          this.closeToolbarPanelOnOutsidePointer(event);
        },
      },
      surface: {
        pendingRequestsSignature: () =>
          requestStateSignature(this.state.requests.approvals, this.state.requests.pendingUserInputs, this.state.requests.userInputDrafts),
        composerPlaceholder: (state) => chatPanelComposerPlaceholder(this.panelSurface.composer, state),
        composerMetaViewModel: (state) => chatPanelComposerMetaViewModel(this.panelSurface.composer, state),
      },
      runtime: {
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
        refresh: refreshThreadsViewLiveState,
        deferRefresh: () => {
          this.containerEl.win.setTimeout(() => {
            refreshThreadsViewLiveState();
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
        set: (statusText, phase) => {
          this.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
        },
      },
    };
  }

  private get state(): ChatState {
    return this.chatState.getState();
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
    return codexPanelDisplayTitle(this.state.activeThread.id, this.state.threadList.listedThreads, this.restoredThreadTitle());
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
    this.controllers.render.mountOrRepairShell();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.controllers.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
  }

  applyAppServerMetadataSnapshot(metadata: SharedServerMetadata): void {
    this.controllers.serverActions.metadata.applyAppServerMetadata(metadata);
  }

  applyAvailableModelsSnapshot(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
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
  }

  async connect(): Promise<void> {
    await this.controllers.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    if (chatTurnBusy(this.state)) return;

    this.controllers.thread.identity.clearActiveThreadContext();
    this.chatState.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "connection/status-set", statusText: "New chat." });
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

  private async ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.controllers.thread.restoration.ensureLoaded();
  }

  private isRestoredThreadPending(threadId: string): boolean {
    return this.controllers.thread.restoration.isPending(threadId);
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
  }

  private restoredThreadPlaceholder() {
    return this.controllers.thread.restoration.placeholder();
  }

  private restoredThreadTitle(): string | null {
    return this.controllers.thread.restoration.title();
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.controllers.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.containerEl.doc.defaultView,
      contains: (element) => this.containerEl.contains(element),
      renameEditing: this.controllers.thread.rename.isEditing(),
    });
  }

  private async refreshDeferredDiagnostics(): Promise<void> {
    if (!this.controllers.connection.manager.isConnected()) return;
    await this.controllers.serverActions.diagnostics.refreshPublishedDiagnosticProbes({ cachedAppServerMetadata: true });
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
    return runtimeSnapshotForChatState(this.state);
  }
}
