import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import { createSystemItem } from "./display/system";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { Model } from "../../generated/app-server/v2/Model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../runtime/collaboration-mode";
import type { RuntimeSnapshot } from "../../runtime/state";
import { pendingRequestsSignature as requestStateSignature } from "./request-state";
import { activeTurnId, chatTurnBusy, createChatStateStore, type ChatState, type ChatAction } from "./chat-state";
import { renderToolbar } from "./ui/toolbar";
import type { ToolbarViewModel } from "./toolbar-model";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import type { RestoredThreadController } from "./controllers/thread/restored-thread-controller";
import type { CodexChatHost } from "./chat-host";
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
import { ChatMessageScrollController } from "./controllers/view/message-scroll-controller";
import { createChatViewEffects, type ChatViewEffects } from "./view-effects";
import { createChatViewControllerAssembly, type ChatViewControllerAssembly } from "./chat-view-controller-assembly";
import { createPanelUiStatePort } from "./controllers/state-ports";

export type { CodexChatHost } from "./chat-host";

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly connection: ChatViewControllerAssembly["connection"];
  private readonly controller: ChatViewControllerAssembly["controller"];
  private readonly appServer: ChatViewControllerAssembly["appServer"];
  private readonly connectionController: ChatViewControllerAssembly["connectionController"];
  private readonly history: ChatViewControllerAssembly["history"];
  private readonly threadResume: ChatViewControllerAssembly["threadResume"];
  private readonly threadActions: ChatViewControllerAssembly["threadActions"];
  private readonly runtimeSettings: ChatViewControllerAssembly["runtimeSettings"];
  private readonly restoredThread: ChatViewControllerAssembly["restoredThread"];
  private readonly threadIdentity: ChatViewControllerAssembly["threadIdentity"];
  private readonly threadRename: ChatViewControllerAssembly["threadRename"];
  private readonly pendingRequests: ChatViewControllerAssembly["pendingRequests"];
  private readonly toolbarPanels: ChatViewControllerAssembly["toolbarPanels"];
  private readonly reconnectActions: ChatViewControllerAssembly["reconnectActions"];
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly effects: ChatViewEffects;
  private readonly composerController: ChatViewControllerAssembly["composerController"];
  private readonly messageRenderer: ChatViewControllerAssembly["messageRenderer"];
  private readonly renderController: ChatViewControllerAssembly["renderController"];
  private readonly openCloseController: ChatViewControllerAssembly["openCloseController"];
  private readonly viewStateController: ChatViewControllerAssembly["viewStateController"];
  private readonly appServerWarmup: ChatViewControllerAssembly["appServerWarmup"];
  private readonly messageScroll: ChatMessageScrollController;
  private readonly composerSubmission: ChatViewControllerAssembly["composerSubmission"];
  private readonly threadSelection: ChatViewControllerAssembly["threadSelection"];
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
      state: createPanelUiStatePort(this.chatState),
      render: () => {
        this.render();
      },
    });
    this.effects = this.createEffects();
    const controllers = createChatViewControllerAssembly({
      app: this.app,
      owner: this,
      plugin: this.plugin,
      stateStore: this.chatState,
      viewId: this.viewId,
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      connectionWork: this.connectionWork,
      messageScroll: this.messageScroll,
      effects: this.effects,
      getState: () => this.state,
      getClient: () => this.client,
      setClient: (client) => {
        this.client = client;
      },
      getOpened: () => this.opened,
      setOpened: (opened) => {
        this.opened = opened;
      },
      getClosing: () => this.closing,
      setClosing: (closing) => {
        this.closing = closing;
      },
      panelRoot: () => this.panelRoot(),
      renderToolbar: (toolbar) => {
        this.renderToolbar(toolbar);
      },
      renderMessages: (parent) => {
        this.renderMessages(parent);
      },
      renderComposer: (parent) => {
        this.renderComposer(parent);
      },
      pendingRequestsSignature: () => this.pendingRequestsSignature(),
      activeComposerThreadName: () => this.activeComposerThreadName(),
      composerPlaceholder: () => this.composerPlaceholder(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
      collaborationModeLabel: () => this.collaborationModeLabel(),
      connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
      mcpStatusLines: () => this.mcpStatusLines(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
      statusSummaryLines: () => this.statusSummaryLines(),
      ensureRestoredThreadLoaded: () => this.ensureRestoredThreadLoaded(),
      startNewThread: () => this.startNewThread(),
      selectThread: (threadId) => this.selectThread(threadId),
      resumeThread: (threadId) => this.resumeThread(threadId),
      refreshThreads: () => this.refreshThreads(),
      refreshSkills: (forceReload) => this.refreshSkills(forceReload),
      publishAppServerMetadataSnapshot: () => {
        this.publishAppServerMetadataSnapshot();
      },
      loadSharedThreadList: () => this.loadSharedThreadList(),
      closeToolbarPanelOnOutsidePointer: (event) => {
        this.closeToolbarPanelOnOutsidePointer(event);
      },
      registerEvent: (eventRef) => {
        this.registerEvent(eventRef);
      },
      registerPointerDown: (handler) => {
        this.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
      },
      registerActiveLeafChange: (handler) => {
        this.registerEvent(this.app.workspace.on("active-leaf-change", handler));
      },
      isOwnLeaf: (candidateLeaf) => candidateLeaf === this.leaf,
      archiveAdapter: () => this.app.vault.adapter,
    });
    this.connection = controllers.connection;
    this.controller = controllers.controller;
    this.appServer = controllers.appServer;
    this.connectionController = controllers.connectionController;
    this.history = controllers.history;
    this.threadResume = controllers.threadResume;
    this.threadActions = controllers.threadActions;
    this.runtimeSettings = controllers.runtimeSettings;
    this.restoredThread = controllers.restoredThread;
    this.threadIdentity = controllers.threadIdentity;
    this.threadRename = controllers.threadRename;
    this.pendingRequests = controllers.pendingRequests;
    this.toolbarPanels = controllers.toolbarPanels;
    this.reconnectActions = controllers.reconnectActions;
    this.composerController = controllers.composerController;
    this.messageRenderer = controllers.messageRenderer;
    this.renderController = controllers.renderController;
    this.openCloseController = controllers.openCloseController;
    this.viewStateController = controllers.viewStateController;
    this.appServerWarmup = controllers.appServerWarmup;
    this.composerSubmission = controllers.composerSubmission;
    this.threadSelection = controllers.threadSelection;
  }

  private createEffects(): ChatViewEffects {
    return createChatViewEffects({
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
        this.messageRenderer.forceMessagesToBottom();
      },
      correctMessagesAfterLayoutChange: () => {
        this.messageRenderer.correctMessagesAfterLayoutChange();
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
      lastFocused: false,
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
    return formatCollaborationModeLabel(this.state.selectedCollaborationMode);
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
