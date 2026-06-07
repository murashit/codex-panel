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
import { activeTurnId, chatTurnBusy, createChatStateStore, type ChatState, type ChatAction } from "./chat-state";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import type { CodexChatHost } from "./chat-host";
import {
  activeThreadTitle as buildActiveThreadTitle,
  chatViewDisplayTitle,
  connectionDiagnosticsModel,
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  runtimeSnapshotForChatState,
  statusSummaryLines as buildStatusSummaryLines,
} from "./view/model";
import { openPanelTurnLifecycle } from "./view/snapshot";
import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  type ChatViewRenderScheduleOptions,
} from "./view/lifecycle";
import { ChatMessageScrollController } from "./controllers/view/message-scroll-controller";
import type { ChatViewEffects } from "./view/effects";
import {
  createChatViewControllerAssembly,
  type ChatViewControllerAssembly,
  type ChatViewControllerAssemblyHost,
  type ChatViewClientPort,
  type ChatViewLifecyclePort,
  type ChatViewObsidianPort,
  type ChatViewRenderPort,
  type ChatViewRuntimePort,
  type ChatViewStatePort,
  type ChatViewThreadPort,
} from "./view/controller-assembly";
import { createPanelUiStatePort } from "./controllers/state-ports";
import { ChatViewSlotRenderers, type ChatViewSlotRendererHost } from "./view/slot-renderers";

export type { CodexChatHost } from "./chat-host";

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly controllers: ChatViewControllerAssembly;
  private readonly chatState = createChatStateStore();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly effects: ChatViewEffects;
  private readonly messageScroll: ChatMessageScrollController;
  private readonly slotRenderers: ChatViewSlotRenderers;
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
    this.messageScroll = new ChatMessageScrollController({
      state: createPanelUiStatePort(this.chatState),
      render: () => {
        this.controllers.render.controller.render();
      },
    });
    this.effects = this.createEffects();
    this.controllers = createChatViewControllerAssembly(this.createControllerHost());
    this.slotRenderers = new ChatViewSlotRenderers(this.createSlotRendererHost());
  }

  private createControllerHost(): ChatViewControllerAssemblyHost {
    return {
      obsidian: this.createControllerObsidianPort(),
      plugin: this.plugin,
      state: this.createControllerStatePort(),
      client: this.createControllerClientPort(),
      lifecycle: this.createControllerLifecyclePort(),
      render: this.createControllerRenderPort(),
      runtime: this.createControllerRuntimePort(),
      thread: this.createControllerThreadPort(),
      effects: this.effects,
    };
  }

  private createControllerObsidianPort(): ChatViewObsidianPort {
    return {
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
      isOwnLeaf: (candidateLeaf) => candidateLeaf === this.leaf,
      archiveAdapter: () => this.app.vault.adapter,
    };
  }

  private createControllerStatePort(): ChatViewStatePort {
    return {
      stateStore: this.chatState,
      getState: () => this.state,
    };
  }

  private createControllerClientPort(): ChatViewClientPort {
    return {
      getClient: () => this.client,
      setClient: (client) => {
        this.client = client;
      },
    };
  }

  private createControllerLifecyclePort(): ChatViewLifecyclePort {
    return {
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      connectionWork: this.connectionWork,
      messageScroll: this.messageScroll,
      getOpened: () => this.opened,
      setOpened: (opened) => {
        this.opened = opened;
      },
      getClosing: () => this.closing,
      setClosing: (closing) => {
        this.closing = closing;
      },
    };
  }

  private createControllerRenderPort(): ChatViewRenderPort {
    return {
      panelRoot: () => this.panelRoot(),
      renderToolbar: (toolbar) => {
        this.slotRenderers.renderToolbar(toolbar);
      },
      renderGoal: (goal) => {
        this.slotRenderers.renderGoal(goal);
      },
      renderMessages: (parent) => {
        this.slotRenderers.renderMessages(parent);
      },
      renderComposer: (parent) => {
        this.slotRenderers.renderComposer(parent);
      },
      pendingRequestsSignature: () => this.slotRenderers.pendingRequestsSignature(),
      activeComposerThreadName: () => this.slotRenderers.activeComposerThreadName(),
      composerPlaceholder: () => this.slotRenderers.composerPlaceholder(),
      composerMetaViewModel: () => this.slotRenderers.composerMetaViewModel(),
      closeToolbarPanelOnOutsidePointer: (event) => {
        this.closeToolbarPanelOnOutsidePointer(event);
      },
    };
  }

  private createControllerRuntimePort(): ChatViewRuntimePort {
    return {
      runtimeSnapshot: () => this.runtimeSnapshot(),
      collaborationModeLabel: () => this.collaborationModeLabel(),
      connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
      mcpStatusLines: () => this.controllers.appServer.diagnostics.mcpStatusLines(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
      statusSummaryLines: () => this.statusSummaryLines(),
    };
  }

  private createControllerThreadPort(): ChatViewThreadPort {
    return {
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
    };
  }

  private createSlotRendererHost(): ChatViewSlotRendererHost {
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
          compactConversation: () => {
            this.controllers.toolbar.panels.closeToolbarPanels();
            return this.compactConversation();
          },
          showGoalEditor: () => {
            this.showGoalEditor();
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
            this.dispatch({ type: "ui/detail-open-set", key: "goal:editor", open });
            this.controllers.render.controller.render({ forceSlots: true });
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

  private createEffects(): ChatViewEffects {
    return {
      render: {
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
          this.messageScroll.forceBottom();
          this.controllers.render.messages.forceMessagesToBottom();
        },
        correctAfterLayoutChange: () => {
          this.controllers.render.messages.correctMessagesAfterLayoutChange();
        },
        preservePosition: () => {
          this.messageScroll.preservePosition();
        },
        bottomOnFocus: () => {
          this.messageScroll.scrollToBottomOnFocus();
        },
      },
      status: {
        set: (status) => {
          this.setStatus(status);
        },
        addSystemMessage: (text) => {
          this.addSystemMessage(text);
        },
        addStructuredSystemMessage: (text, details) => {
          this.addStructuredSystemMessage(text, details);
        },
      },
      thread: {
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
      lifecycle: {
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
      state: {
        dispatch: (action) => {
          this.dispatch(action);
        },
        systemItem: (text) => this.systemItem(text),
      },
      client: {
        clear: () => {
          this.client = null;
        },
        ensureConnected: () => this.controllers.connection.controller.ensureConnected(),
      },
      composer: {
        setText: (text) => {
          this.setComposerText(text);
        },
      },
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

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.controllers.appServer.threads.applyThreadList(threads);
    this.refreshTabHeader();
    this.controllers.render.controller.render();
  }

  applyAppServerMetadataSnapshot(metadata: SharedAppServerMetadata): void {
    this.controllers.appServer.metadata.applyAppServerMetadata(metadata);
    this.controllers.render.controller.render();
  }

  applyAvailableModelsSnapshot(models: readonly Model[]): void {
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
    this.messageScroll.scrollToBottomOnFocus();
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
    this.setStatus("New chat.");
    this.messageScroll.forceBottom();
    this.controllers.render.controller.render();
    this.focusComposer();
  }

  private async compactConversation(): Promise<void> {
    const threadId = this.state.activeThread.id;
    if (!threadId) {
      this.addSystemMessage("No active thread to compact.");
      return;
    }
    await this.controllers.thread.actions.compactThread(threadId);
  }

  private showGoalEditor(): void {
    this.chatState.dispatch({ type: "ui/panel-set", panel: null });
    this.chatState.dispatch({ type: "ui/detail-open-set", key: "goal:editor", open: true });
    this.controllers.render.controller.render({ forceSlots: true });
  }

  private async saveGoalObjective(objective: string, tokenBudget: number | null): Promise<void> {
    let threadId = this.state.activeThread.id;
    if (!threadId) {
      try {
        await this.controllers.connection.controller.ensureConnected();
        const response = await this.controllers.appServer.threads.startThread(objective, { syncGoal: false });
        threadId = response?.thread.id ?? null;
      } catch (error) {
        this.addSystemMessage(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    if (!threadId) return;
    void this.controllers.runtime.goals.setObjective(threadId, objective, tokenBudget);
  }

  private async refreshDiagnostics(): Promise<void> {
    await this.controllers.connection.controller.refreshDiagnostics();
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

  private async submitComposerAction(): Promise<void> {
    await this.controllers.composer.submission.submit();
  }

  private async setRequestedModelFromUi(model: string | null): Promise<void> {
    await this.controllers.runtime.settings.setRequestedModelFromUi(model);
  }

  private async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    await this.controllers.runtime.settings.setRequestedReasoningEffortFromUi(effort);
  }

  private systemItem(text: string): DisplayItem {
    return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
  }

  private addSystemMessage(text: string): void {
    this.controllers.inbound.controller.addSystemMessage(text);
    this.controllers.render.controller.render();
  }

  private addStructuredSystemMessage(text: string, details: DisplayDetailSection[]): void {
    this.controllers.inbound.controller.addStructuredSystemMessage(text, details);
    this.controllers.render.controller.render();
  }

  private addDedupedSystemMessage(text: string): void {
    this.controllers.inbound.controller.addDedupedSystemMessage(text);
    this.controllers.render.controller.render();
  }

  private setStatus(status: string): void {
    this.dispatch({ type: "connection/status-set", status });
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
    return runtimeSnapshotForChatState({ state });
  }
}
