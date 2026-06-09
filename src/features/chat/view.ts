import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { PanelModelOption } from "../../domain/catalog/metadata";
import type { PanelThread } from "../../domain/threads/model";
import { collaborationModeLabel as formatCollaborationModeLabel } from "./runtime/override-commands";
import type { RuntimeSnapshot } from "./runtime/effective-settings";
import { chatTurnBusy, createChatStateStore, type ChatState, type ChatAction } from "./chat-state";
import type { OpenCodexPanelSnapshot } from "../../workspace/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../app-server/shared-cache-state";
import type { CodexChatHost } from "./chat-host";
import { createSystemItem } from "./display/system";
import {
  activeThreadTitle as buildActiveThreadTitle,
  chatViewDisplayTitle,
  connectionDiagnosticsModel,
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  runtimeSnapshotForChatSlices,
  statusSummaryLines as buildStatusSummaryLines,
} from "./panel/model";
import { openPanelTurnLifecycle } from "./panel/snapshot";
import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  type ChatViewRenderScheduleOptions,
} from "./panel/lifecycle";
import { ChatMessageScrollIntentController } from "./panel/message-scroll-intent-controller";
import type { ChatPanelContext } from "./panel/context";
import { createChatViewControllers, type ChatViewControllers } from "./panel/composition";
import { activeComposerThreadName, composerMetaViewModel, composerPlaceholder, renderComposerSlot } from "./panel/slots/composer";
import { renderGoalSlot } from "./panel/slots/goal";
import { pendingRequestsSignature, renderMessagesSlot } from "./panel/slots/messages";
import { renderToolbarSlot } from "./panel/slots/toolbar";
import type { ChatViewSlotRendererPorts } from "./panel/slots/types";

export type { CodexChatHost } from "./chat-host";

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly controllers: ChatViewControllers;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly messageScrollIntent: ChatMessageScrollIntentController;
  private readonly slotPorts: ChatViewSlotRendererPorts;
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
      this.controllers.thread.history.invalidate();
    });
    this.messageScrollIntent = new ChatMessageScrollIntentController();
    this.controllers = createChatViewControllers(this.createControllerPorts());
    this.slotPorts = this.createSlotRendererPorts();
  }

  private createControllerPorts(): ChatPanelContext {
    // Some callbacks are late-bound to controllers assigned immediately after this object is created.
    // Controller constructors must not invoke those callbacks synchronously during composition.
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
        registerActiveLeafChange: (handler) => {
          this.registerEvent(this.app.workspace.on("active-leaf-change", handler));
        },
        handleActiveLeafChange: (leaf) => {
          if (leaf === this.leaf) this.forceMessagesToBottomOnFocus();
        },
        archiveAdapter: () => this.app.vault.adapter,
      },
      plugin: this.plugin,
      state: {
        stateStore: this.chatState,
        getState: () => this.state,
        systemItem: (text) => this.systemItem(text),
      },
      client: {
        getClient: () => this.client,
        setClient: (client) => {
          this.client = client;
        },
        clear: () => {
          this.client = null;
        },
        ensureConnected: () => this.controllers.connection.controller.ensureConnected(),
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
          this.controllers.connection.controller.invalidate();
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
      },
      render: {
        panelRoot: () => this.panelRoot(),
        renderToolbar: (toolbar) => {
          renderToolbarSlot(toolbar, this.slotPorts);
        },
        renderGoal: (goal) => {
          renderGoalSlot(goal, this.slotPorts);
        },
        renderMessages: (parent) => {
          renderMessagesSlot(parent, this.slotPorts);
        },
        renderComposer: (parent) => {
          renderComposerSlot(parent, this.slotPorts);
        },
        pendingRequestsSignature: () => pendingRequestsSignature(this.slotPorts),
        activeComposerThreadName: () => activeComposerThreadName(this.slotPorts),
        composerPlaceholder: () => composerPlaceholder(this.slotPorts),
        composerMetaViewModel: () => composerMetaViewModel(this.slotPorts),
        closeToolbarPanelOnOutsidePointer: (event) => {
          this.closeToolbarPanelOnOutsidePointer(event);
        },
        now: () => {
          this.controllers.render.controller.render();
        },
        shellSlots: () => {
          this.controllers.render.controller.renderShellSlots();
        },
        schedule: (options) => {
          this.scheduleRender(options);
        },
      },
      runtime: {
        runtimeSnapshot: () => this.runtimeSnapshot(),
        collaborationModeLabel: () => this.collaborationModeLabel(),
        connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
        mcpStatusLines: () => this.controllers.appServer.diagnostics.mcpStatusLines(),
        modelStatusLines: () => this.modelStatusLines(),
        effortStatusLines: () => this.effortStatusLines(),
        statusSummaryLines: () => this.statusSummaryLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: () => this.ensureRestoredThreadLoaded(),
        startNewThread: () => this.startNewThread(),
        selectThread: (threadId) => this.controllers.thread.selection.selectThread(threadId),
        resumeThread: (threadId) => this.controllers.thread.resume.resumeThread(threadId),
        refreshThreads: () => this.controllers.connection.controller.refreshThreads(),
        refreshSkills: (forceReload) => this.controllers.connection.controller.refreshSkills(forceReload),
        publishAppServerMetadataSnapshot: () => {
          this.controllers.appServer.metadata.publishAppServerMetadataSnapshot();
        },
        loadSharedThreadList: () => this.loadSharedThreadList(),
        notifyIdentityChanged: () => {
          this.notifyActiveThreadIdentityChanged();
        },
        resetTurnPresence: (hadTurns) => {
          this.controllers.thread.rename.resetThreadTurnPresence(hadTurns);
        },
        restorePlaceholder: (restoredThread) => {
          this.controllers.thread.restored.restore(restoredThread);
        },
        clearRestoredLifecycle: () => {
          this.controllers.thread.restored.clear();
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
          this.controllers.render.messages.forceMessagesToBottom();
        },
        preservePosition: () => {
          this.messageScrollIntent.preservePosition();
        },
      },
      status: {
        set: (status) => {
          this.dispatch({ type: "connection/status-set", status });
        },
        addSystemMessage: (text) => {
          this.controllers.inbound.controller.addSystemMessage(text);
          this.controllers.render.controller.render();
        },
        addStructuredSystemMessage: (text, details) => {
          this.controllers.inbound.controller.addStructuredSystemMessage(text, details);
          this.controllers.render.controller.render();
        },
      },
      composer: {
        setText: (text) => {
          this.controllers.composer.controller.setDraft(text, { focus: true, renderIfDetached: true });
        },
      },
    };
  }

  private createSlotRendererPorts(): ChatViewSlotRendererPorts {
    return {
      state: {
        chat: () => this.state,
        connected: () => this.controllers.connection.manager.isConnected(),
        turnBusy: () => this.turnBusy,
      },
      settings: {
        vaultPath: () => this.plugin.vaultPath,
        configuredCommand: () => this.plugin.settings.codexPath,
        archiveExportEnabled: () => this.plugin.settings.archiveExportEnabled,
        sendShortcut: () => this.plugin.settings.sendShortcut,
      },
      thread: {
        restoredPlaceholder: () => this.restoredThreadPlaceholder(),
      },
      runtime: {
        snapshot: () => this.runtimeSnapshot(),
        setRequestedModel: (model) => this.setRequestedModelFromUi(model),
        setRequestedReasoningEffort: (effort) => this.setRequestedReasoningEffortFromUi(effort),
      },
      actions: {
        toolbar: {
          archiveConfirmId: () => this.controllers.toolbar.panels.archiveConfirmId(),
          renameState: (threadId) => this.controllers.thread.rename.editState(threadId),
          startNewThread: () => this.startNewThread(),
          toggleChatActions: () => {
            this.controllers.toolbar.panels.toggleChatActions();
          },
          compactConversation: () => this.compactConversation(),
          showGoalEditor: () => {
            this.setGoalEditingOpen(true, { closeToolbarPanel: true });
          },
          toggleHistory: () => {
            this.controllers.toolbar.panels.toggleHistory();
          },
          toggleStatusPanel: () => {
            this.controllers.toolbar.panels.toggleStatus();
          },
          reconnectPanel: () => this.controllers.connection.reconnect.reconnectPanel(),
          refreshStatusPanel: () => this.controllers.connection.controller.refreshStatusPanel(),
          selectThreadFromToolbar: (threadId) => this.controllers.thread.selection.selectThreadFromToolbar(threadId),
          startArchive: (threadId) => {
            this.controllers.toolbar.panels.startArchive(threadId);
          },
          archiveThread: (threadId, saveMarkdown) => this.controllers.toolbar.panels.archiveThread(threadId, saveMarkdown),
          startRename: (threadId) => {
            this.controllers.thread.rename.start(threadId);
          },
          updateRenameDraft: (threadId, value) => {
            this.controllers.thread.rename.updateDraft(threadId, value);
          },
          saveRename: (threadId, value) => this.controllers.thread.rename.save(threadId, value),
          cancelRename: (threadId) => {
            this.controllers.thread.rename.cancel(threadId);
          },
          autoNameDraft: (threadId) => this.controllers.thread.rename.autoNameDraft(threadId),
        },
        goal: {
          saveObjective: (objective, tokenBudget) => this.saveGoalObjective(objective, tokenBudget),
          setStatus: (threadId, status) => this.controllers.runtime.goals.setStatus(threadId, status),
          clear: (threadId) => this.controllers.runtime.goals.clear(threadId),
          setEditingOpen: (open) => {
            this.setGoalEditingOpen(open);
          },
        },
      },
      slots: {
        renderMessages: (parent) => {
          this.controllers.render.messages.render(parent);
        },
        renderComposer: (parent) => {
          this.controllers.composer.controller.render(parent);
        },
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
    this.controllers.render.controller.render({ forceSlots: true });
  }

  private async saveGoalObjective(objective: string, tokenBudget: number | null): Promise<void> {
    let threadId = this.state.activeThread.id;
    if (!threadId) {
      try {
        await this.controllers.connection.controller.ensureConnected();
        const response = await this.controllers.appServer.threads.startThread(objective, { syncGoal: false });
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
    this.controllers.render.viewState.applyState(state);
  }

  refreshSettings(): void {
    this.controllers.render.controller.render();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly PanelThread[]): void {
    this.controllers.appServer.threads.applyThreadList(threads);
    this.refreshTabHeader();
    this.controllers.render.controller.render();
  }

  applyAppServerMetadataSnapshot(metadata: SharedAppServerMetadata): void {
    this.controllers.appServer.metadata.applyAppServerMetadata(metadata);
    this.controllers.render.controller.render();
  }

  applyAvailableModelsSnapshot(models: readonly PanelModelOption[]): void {
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
    this.forceMessagesToBottomOnFocus();
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
    this.controllers.render.openClose.open();
  }

  override async onClose(): Promise<void> {
    this.controllers.render.openClose.close();
  }

  setComposerText(text: string): void {
    this.controllers.composer.controller.setDraft(text, { focus: true, renderIfDetached: true });
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
    const threads = await this.plugin.refreshThreadList(() => this.controllers.appServer.threads.loadThreadList());
    this.controllers.appServer.threads.applyThreadList(threads);
  }

  private requestWorkspaceLayoutSave(): void {
    void this.app.workspace.requestSaveLayout();
  }

  private async setRequestedModelFromUi(model: string | null): Promise<void> {
    await this.controllers.runtime.settings.setRequestedModelFromUi(model);
  }

  private async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    await this.controllers.runtime.settings.setRequestedReasoningEffortFromUi(effort);
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
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

  private forceMessagesToBottomOnFocus(): void {
    this.messageScrollIntent.forceBottom();
    this.controllers.render.messages.forceMessagesToBottom();
  }

  private scheduleDeferredAppServerWarmup(): void {
    this.controllers.connection.warmup.schedule();
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

  private scheduleRender(options: ChatViewRenderScheduleOptions = {}): void {
    this.deferredTasks.scheduleRender((renderOptions) => {
      this.controllers.render.controller.render(renderOptions);
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
    if (!this.controllers.connection.manager.isConnected()) return;
    await this.controllers.appServer.diagnostics.refreshPublishedCapabilityDiagnostics({ cachedAppServerMetadata: true });
    this.controllers.render.controller.render();
  }

  private panelRoot(): HTMLElement | null {
    return (this.containerEl.children[1] as HTMLElement | undefined) ?? null;
  }

  private statusSummaryLines(): string[] {
    return buildStatusSummaryLines({
      activeThreadId: this.state.activeThread.id,
      snapshot: this.runtimeSnapshot(),
    });
  }

  private modelStatusLines(): string[] {
    return buildModelStatusLines({
      effectiveConfig: this.state.connection.effectiveConfig,
      requestedModel: this.state.runtime.requestedModel,
      snapshot: this.runtimeSnapshot(),
      collaborationModeLabel: this.collaborationModeLabel(),
    });
  }

  private effortStatusLines(): string[] {
    return buildEffortStatusLines({
      effectiveConfig: this.state.connection.effectiveConfig,
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
    return runtimeSnapshotForChatSlices({
      effectiveConfig: state.connection.effectiveConfig,
      activeThread: state.activeThread,
      runtime: state.runtime,
      rateLimit: state.connection.rateLimit,
      displayItems: state.transcript.displayItems,
      availableModels: state.connection.availableModels,
    });
  }
}
