import { ItemView, MarkdownRenderer, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "./app-server/client";
import { ConnectionManager, StaleConnectionError } from "./app-server/connection-manager";
import type { ApprovalAction, PendingApproval } from "./approvals/model";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionSignature,
  composerSuggestionNavigationDirection,
  nextComposerSuggestionIndex,
  parseSlashCommand,
  type ComposerSuggestion,
  type NoteCandidate,
} from "./composer/suggestions";
import { isComposerSendKey } from "./composer/keys";
import { userInputWithWikiLinkMentions } from "./composer/wikilink-context";
import { VIEW_TYPE_CODEX_PANEL } from "./constants";
import { createSystemItem } from "./display/model";
import type { DisplayItem } from "./display/types";
import type { ReasoningEffort } from "./generated/app-server/ReasoningEffort";
import type { UserInput } from "./generated/app-server/v2/UserInput";
import type { ServiceTier } from "./app-server/service-tier";
import {
  collaborationModeLabel as formatCollaborationModeLabel,
  collaborationModeToggleMessage,
  nextCollaborationMode,
} from "./panel/collaboration-mode";
import { PanelController } from "./panel/controller";
import { connectionDiagnosticLines, connectionDiagnosticRows } from "./panel/diagnostics";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "./panel/runtime-view";
import {
  configRecord,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  fastModeLabel,
  commitRuntimeOverride,
  resetRuntimeOverride,
  requestedOrConfiguredServiceTier,
  requestedTurnRuntimeSettings,
  runtimeSummaryLabel,
  runtimeOverrideLabel,
  serviceTierLabel,
  setRuntimeOverride,
  sortedAvailableModels,
  supportedReasoningEfforts,
  type RuntimeSnapshot,
} from "./panel/runtime-state";
import { compactContextLabel, modelOverrideMessage, reasoningEffortOverrideMessage } from "./panel/runtime-settings";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult, type SlashCommandName } from "./panel/slash-commands";
import { PanelSessionController } from "./panel/session-controller";
import { ThreadHistoryLoader } from "./panel/thread-history";
import { ThreadRenameController } from "./panel/thread-rename";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings";
import { CodexPanelSettingTab } from "./settings-tab";
import { clearActiveThreadState, clearConnectionScopedState, createPanelState, type PanelState } from "./state/panel-state";
import { userInputDraftKey, userInputOtherDraftKey } from "./panel/request-state";
import { getThreadTitle } from "./threads";
import { questionDefaultAnswer, type PendingUserInput } from "./user-input/model";
import {
  renderComposerShell,
  renderComposerSuggestions,
  syncComposerControls as syncComposerControlElements,
  syncComposerHeight,
} from "./view/composer";
import { renderTextWithWikiLinks as renderInlineWikiLinks, shortSignature } from "./view/dom";
import { messageRenderBlocks } from "./view/message-stream";
import { renderPendingRequestMessage } from "./view/pending-request-message";
import { bottomScrollTop, captureScrollAnchor, isNearScrollBottom, restoreScrollAnchor } from "./view/scroll";
import { renderToolbar, toolbarSignature, type ToolbarChoice, type ToolbarViewModel } from "./view/toolbar";

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";

  async onload(): Promise<void> {
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexPanelView(leaf, this));

    this.addRibbonIcon("bot-message-square", "Open panel", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "open-new-panel",
      name: "Open new panel",
      callback: () => void this.activateNewView(),
    });

    this.addCommand({
      id: "new-chat",
      name: "New chat",
      callback: async () => {
        const view = await this.activateView();
        await view.startNewThread();
      },
    });

    this.addSettingTab(new CodexPanelSettingTab(this.app, this));
  }

  async activateView(): Promise<CodexPanelView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as CodexPanelView;
  }

  async activateNewView(): Promise<CodexPanelView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as CodexPanelView;
  }

  private createRightSidebarTab(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL).find((leaf) => leaf.getRoot() === workspace.rightSplit);
    if (!existing) return workspace.getRightLeaf(false);

    return workspace.createLeafInParent(existing.parent, Number.MAX_SAFE_INTEGER);
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexPanelView) {
        leaf.view.refreshSettings();
      }
    }
  }

  refreshOpenThreadLists(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexPanelView) {
        leaf.view.refreshThreadList();
      }
    }
  }

  async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = normalizeSettings(data);
    if (!settingsMatchNormalizedData(data, this.settings)) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class CodexPanelView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly connection: ConnectionManager;
  private readonly controller: PanelController;
  private readonly session: PanelSessionController;
  private readonly history: ThreadHistoryLoader;
  private readonly threadRename: ThreadRenameController;
  private readonly state: PanelState = createPanelState();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly blockSignatures = new Map<string, string>();
  private noteCandidatesCache: NoteCandidate[] | null = null;
  private noteEventsRegistered = false;
  private composer: HTMLTextAreaElement | null = null;
  private composerSuggestEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private configSlotEl: HTMLElement | null = null;
  private messagesSlotEl: HTMLElement | null = null;
  private composerSlotEl: HTMLElement | null = null;
  private scheduledRenderTimer: number | null = null;
  private toolbarSignature: string | null = null;
  private forceScrollMessagesToBottomOnNextRender = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexPanelPlugin,
  ) {
    super(leaf);
    this.connection = new ConnectionManager(() => this.plugin.settings.codexPath, this.plugin.vaultPath, {
      onNotification: (notification) => {
        this.controller.handleNotification(notification);
        this.scheduleRender();
      },
      onServerRequest: (request) => {
        this.controller.handleServerRequest(request);
        this.render();
      },
      onLog: (message) => {
        this.controller.handleAppServerLog(message);
        this.render();
      },
      onExit: () => {
        this.setStatus("Codex app-server stopped.");
        clearConnectionScopedState(this.state);
        this.threadRename.resetThreadTurnPresence(false);
        this.client = null;
        this.render();
      },
    });
    this.controller = new PanelController(this.state, {
      refreshThreads: () => void this.refreshThreads(),
      maybeNameThread: (threadId, turn) => this.threadRename.maybeAutoNameThread(threadId, turn),
      respondToServerRequest: (requestId, result) => this.respondToServerRequest(requestId, result),
      rejectServerRequest: (requestId, code, message) => this.rejectServerRequest(requestId, code, message),
    });
    this.session = new PanelSessionController({
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.connection.currentClient(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
      setStatus: (status) => this.setStatus(status),
      addSystemMessage: (text) => this.addSystemMessage(text),
      addDedupedSystemMessage: (text) => this.addDedupedSystemMessage(text),
      forceMessagesToBottom: () => this.forceMessagesToBottom(),
    });
    this.history = new ThreadHistoryLoader({
      state: this.state,
      currentClient: () => this.client,
      render: () => this.render(),
      addSystemMessage: (text) => this.addSystemMessage(text),
      forceMessagesToBottom: () => this.forceMessagesToBottom(),
      keepCurrentScrollPosition: () => {
        this.forceScrollMessagesToBottomOnNextRender = false;
      },
      setThreadTurnPresence: (hadTurns) => this.threadRename.resetThreadTurnPresence(hadTurns),
    });
    this.threadRename = new ThreadRenameController({
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.connection.currentClient(),
      refreshThreads: () => this.refreshThreads(),
      render: () => this.render(),
      addSystemMessage: (text) => this.addSystemMessage(text),
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  getDisplayText(): string {
    return "Codex";
  }

  getIcon(): string {
    return "bot-message-square";
  }

  refreshSettings(): void {
    this.render();
  }

  refreshThreadList(): void {
    void this.refreshThreads();
  }

  async onOpen(): Promise<void> {
    this.registerNoteIndexInvalidation();
    this.registerDomEvent(activeDocument, "pointerdown", (event) => this.closeToolbarPanelOnOutsidePointer(event));
    this.render();
    await this.ensureConnected();
  }

  async onClose(): Promise<void> {
    if (this.scheduledRenderTimer !== null) {
      window.clearTimeout(this.scheduledRenderTimer);
      this.scheduledRenderTimer = null;
    }
    this.connection.disconnect();
    this.client = null;
  }

  setComposerText(text: string): void {
    this.state.composerDraft = text;
    if (this.composer) {
      this.composer.value = text;
      syncComposerHeight(this.composer);
      this.composer.focus();
    } else {
      this.render();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection.isConnected()) {
      this.client = this.connection.currentClient();
      return;
    }

    this.setStatus("Starting Codex app-server...");
    try {
      this.state.initializeResponse = await this.connection.connect();
      this.client = this.connection.currentClient();
      if (!this.client) throw new Error("Codex app-server connection did not initialize.");
      await this.session.refreshSessionMetadata();
      await this.session.refreshThreadList();
      this.setStatus("Connected.");
    } catch (error) {
      if (error instanceof StaleConnectionError) return;
      this.setStatus("Connection failed.");
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      new Notice("Codex app-server connection failed.");
    }
    this.scheduleRender();
  }

  async startNewThread(): Promise<void> {
    if (this.state.busy) return;

    await this.ensureConnected();
    if (!this.client) return;

    try {
      const response = await this.session.startThread();
      if (!response) return;
      this.threadRename.resetThreadTurnPresence(false);
      this.state.displayItems = [this.systemItem(`Started thread ${response.thread.id}`)];
      this.forceMessagesToBottom();
      await this.refreshThreads();
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async refreshThreads(): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    try {
      await this.session.refreshThreadList();
      await this.session.refreshSessionMetadata();
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async resumeThread(threadId: string): Promise<void> {
    if (this.state.busy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    await this.ensureConnected();
    if (!this.client) return;

    try {
      const response = await this.client.resumeThread(threadId, this.plugin.vaultPath);
      this.state.activeThreadId = response.thread.id;
      this.state.activeThreadCwd = response.cwd ?? response.thread.cwd ?? this.plugin.vaultPath;
      this.state.activeTurnId = null;
      this.state.activeModel = response.model ?? null;
      this.state.activeServiceTier = response.serviceTier ?? null;
      this.state.activeThreadCliVersion = response.thread.cliVersion ?? null;
      this.state.tokenUsage = null;
      this.state.displayItems = [];
      this.state.historyCursor = null;
      this.threadRename.resetThreadTurnPresence(false);
      this.forceMessagesToBottom();
      await this.history.loadLatest(response.thread.id);
      if (this.state.displayItems.length === 0) {
        this.state.displayItems.push(this.systemItem(`Resumed thread ${response.thread.id}`));
        this.forceMessagesToBottom();
        this.render();
      }
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async sendMessage(): Promise<void> {
    const text = this.state.composerDraft.trim();
    if (!text) return;

    await this.ensureConnected();
    if (!this.client) return;

    const slashCommand = parseSlashCommand(text);
    if (slashCommand) {
      this.state.composerDraft = "";
      if (this.composer) {
        this.composer.value = "";
        syncComposerHeight(this.composer);
      }
      this.clearComposerSuggestions();
      const result = await this.executeSlashCommand(slashCommand.command, slashCommand.args);
      if (result?.sendText) {
        await this.sendTurnText(result.sendText);
      }
      this.render();
      return;
    }

    await this.sendTurnText(text);
  }

  private async sendTurnText(text: string): Promise<void> {
    const client = this.client;
    if (!client) return;

    if (this.state.busy) {
      await this.steerCurrentTurn(text);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!this.state.activeThreadId) {
        const threadResponse = await this.session.startThread();
        if (!threadResponse) return;
        this.threadRename.resetThreadTurnPresence(false);
      }

      optimisticUserId = `local-user-${Date.now()}`;
      this.state.displayItems.push({
        id: optimisticUserId,
        kind: "message",
        role: "user",
        text,
        markdown: true,
      });
      this.forceMessagesToBottom();
      this.state.composerDraft = "";
      if (this.composer) {
        this.composer.value = "";
        syncComposerHeight(this.composer);
      }
      this.state.busy = true;
      this.render();

      const turnSettings = requestedTurnRuntimeSettings(this.runtimeSnapshot());
      if (turnSettings.warning) {
        this.addSystemMessage(`${this.collaborationModeLabel()} mode is selected, but ${turnSettings.warning}`);
      }
      const codexInput = this.codexInput(text);
      const activeThreadId = this.state.activeThreadId;
      if (!activeThreadId) return;
      const response = await client.startTurn(
        activeThreadId,
        this.plugin.vaultPath,
        codexInput,
        requestedOrConfiguredServiceTier(this.runtimeSnapshot()),
        turnSettings.collaborationMode,
        turnSettings.model,
        turnSettings.effort,
      );
      this.state.requestedModel = commitRuntimeOverride(this.state.requestedModel);
      this.state.requestedReasoningEffort = commitRuntimeOverride(this.state.requestedReasoningEffort);
      this.state.activeTurnId = response.turn.id;
      this.state.displayItems = this.state.displayItems.map((item) =>
        item.id === optimisticUserId ? { ...item, turnId: response.turn.id } : item,
      );
      this.setStatus("Turn running...");
    } catch (error) {
      this.state.busy = false;
      if (optimisticUserId) this.state.displayItems = this.state.displayItems.filter((item) => item.id !== optimisticUserId);
      this.state.composerDraft = text;
      if (this.composer) {
        this.composer.value = text;
        syncComposerHeight(this.composer);
      }
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    this.scheduleRender();
  }

  private async steerCurrentTurn(text: string): Promise<void> {
    if (!this.client || !this.state.activeThreadId || !this.state.activeTurnId) {
      this.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const threadId = this.state.activeThreadId;
    const expectedTurnId = this.state.activeTurnId;

    this.state.composerDraft = "";
    if (this.composer) {
      this.composer.value = "";
      syncComposerHeight(this.composer);
    }
    this.clearComposerSuggestions();
    this.syncComposerControls();

    try {
      await this.client.steerTurn(threadId, expectedTurnId, this.codexInput(text));
      this.state.displayItems.push({
        id: `local-steer-${Date.now()}`,
        kind: "message",
        role: "user",
        text,
        turnId: expectedTurnId,
        markdown: true,
      });
      this.forceMessagesToBottom();
      this.setStatus("Steered current turn.");
    } catch (error) {
      this.state.composerDraft = text;
      if (this.composer) {
        this.composer.value = text;
        syncComposerHeight(this.composer);
        this.composer.focus();
      }
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.scheduleRender();
  }

  private async interruptTurn(): Promise<void> {
    if (!this.client || !this.state.activeThreadId || !this.state.activeTurnId) return;
    try {
      await this.client.interruptTurn(this.state.activeThreadId, this.state.activeTurnId);
      this.setStatus("Interrupt requested.");
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async submitComposerAction(): Promise<void> {
    const draft = this.composer?.value.trim() ?? this.state.composerDraft.trim();
    if (this.state.busy && this.state.activeThreadId && this.state.activeTurnId && draft.length === 0) {
      await this.interruptTurn();
      return;
    }
    await this.sendMessage();
  }

  private async executeSlashCommand(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | void> {
    if (!this.client) return;
    return runSlashCommand(command, args, {
      activeThreadId: this.state.activeThreadId,
      listedThreads: this.state.listedThreads,
      startNewThread: () => this.startNewThread(),
      resumeThread: (threadId) => this.resumeThread(threadId),
      forkThread: (threadId) => this.forkThread(threadId),
      compactThread: async (threadId) => {
        await this.client?.compactThread(threadId);
      },
      toggleFastMode: () => this.toggleFastMode(),
      toggleCollaborationMode: () => this.toggleCollaborationMode(),
      addSystemMessage: (text) => this.addSystemMessage(text),
      setStatus: (status) => this.setStatus(status),
      setRequestedModel: (model) => this.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => this.setRequestedReasoningEffort(effort),
      statusSummaryLines: () => this.statusSummaryLines(),
      connectionDiagnosticLines: () => this.connectionDiagnosticLines(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
    });
  }

  private toggleFastMode(): void {
    const current = currentServiceTier(this.runtimeSnapshot(), configRecord(this.state.effectiveConfig));
    const next: ServiceTier = current === "fast" ? "standard" : "fast";
    this.state.requestedServiceTier = next;
    this.state.activeServiceTier = next;
    this.state.runtimePicker = null;
    this.addSystemMessage(next === "fast" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.");
  }

  private toggleCollaborationMode(): void {
    const next = nextCollaborationMode(this.state.requestedCollaborationMode);
    this.state.requestedCollaborationMode = next;
    this.state.runtimePicker = null;
    this.addSystemMessage(collaborationModeToggleMessage(next));
  }

  private toggleRuntimePicker(picker: NonNullable<PanelState["runtimePicker"]>): void {
    this.state.runtimePicker = this.state.runtimePicker === picker ? null : picker;
    if (this.state.runtimePicker !== null) {
      this.state.openDetails.delete("history");
      this.state.openDetails.delete("status-panel");
    }
    this.render();
  }

  private setRequestedModelFromUi(model: string | null): void {
    this.setRequestedModel(model);
    this.state.runtimePicker = null;
    this.addSystemMessage(modelOverrideMessage(model));
  }

  private setRequestedModel(model: string | null): void {
    this.state.requestedModel = model === null ? resetRuntimeOverride() : setRuntimeOverride(model);
  }

  private setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): void {
    this.setRequestedReasoningEffort(effort);
    this.state.runtimePicker = null;
    this.addSystemMessage(reasoningEffortOverrideMessage(effort));
  }

  private setRequestedReasoningEffort(effort: ReasoningEffort | null): void {
    this.state.requestedReasoningEffort = effort === null ? resetRuntimeOverride() : setRuntimeOverride(effort);
  }

  private async resolveApproval(approval: PendingApproval, action: ApprovalAction): Promise<void> {
    this.controller.resolveApproval(approval, action);
    this.render();
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

  private async resolveUserInput(input: PendingUserInput): Promise<void> {
    this.controller.resolveUserInput(input, this.answersForUserInput(input));
    this.render();
  }

  private async cancelUserInput(input: PendingUserInput): Promise<void> {
    this.controller.cancelUserInput(input);
    this.render();
  }

  private systemItem(text: string): DisplayItem {
    return createSystemItem(text);
  }

  private addSystemMessage(text: string): void {
    this.controller.addSystemMessage(text);
    this.render();
  }

  private addDedupedSystemMessage(text: string): void {
    this.controller.addDedupedSystemMessage(text);
    this.render();
  }

  private setStatus(status: string): void {
    this.state.status = status;
  }

  private render(): void {
    if (this.scheduledRenderTimer !== null) {
      window.clearTimeout(this.scheduledRenderTimer);
      this.scheduledRenderTimer = null;
    }
    const root = this.containerEl.children[1] as HTMLElement;
    if (!this.toolbarEl || !this.configSlotEl || !this.messagesSlotEl || !this.composerSlotEl) {
      this.renderShell(root);
    }
    if (!this.toolbarEl || !this.configSlotEl || !this.messagesSlotEl || !this.composerSlotEl) {
      return;
    }

    this.renderToolbarIfNeeded(this.toolbarEl);

    this.configSlotEl.empty();

    this.renderMessages(this.messagesSlotEl);
    this.renderComposer(this.composerSlotEl);
    this.syncComposerControls();
  }

  private renderToolbarIfNeeded(toolbar: HTMLElement): void {
    const model = this.toolbarViewModel();
    const signature = toolbarSignature(model);
    if (this.toolbarSignature === signature) return;

    this.toolbarSignature = signature;
    renderToolbar(toolbar, model, {
      toggleHistory: () => this.toggleHistoryPanel(),
      toggleStatusPanel: () => this.toggleStatusPanel(),
      togglePlan: () => this.toggleCollaborationMode(),
      toggleFast: () => this.toggleFastMode(),
      toggleRuntime: () => this.toggleRuntimePicker("model"),
      connect: () => void this.reconnectFromToolbar(),
      refreshThreads: () => {
        this.state.openDetails.delete("status-panel");
        void this.refreshThreads();
      },
      resumeThread: (threadId) => {
        if (this.state.busy && threadId !== this.state.activeThreadId) return;
        this.state.openDetails.delete("history");
        void this.resumeThread(threadId);
      },
      archiveThread: (threadId) => void this.archiveThread(threadId),
      startRenameThread: (threadId) => this.threadRename.start(threadId),
      updateRenameDraft: (threadId, value) => this.threadRename.updateDraft(threadId, value),
      saveRenameThread: (threadId, value) => void this.threadRename.save(threadId, value),
      cancelRenameThread: (threadId) => this.threadRename.cancel(threadId),
      autoNameThread: (threadId) => void this.threadRename.autoNameDraft(threadId),
    });
  }

  private toolbarViewModel(): ToolbarViewModel {
    const snapshot = this.runtimeSnapshot();
    const config = configRecord(this.state.effectiveConfig);
    const context = contextSummary(snapshot);
    const limit = rateLimitSummary(snapshot);
    const historyOpen = this.state.openDetails.has("history");
    const statusPanelOpen = this.state.openDetails.has("status-panel");
    const runtimeOpen = this.state.runtimePicker !== null;
    const statusState = this.state.busy ? "running" : this.connection.isConnected() ? "connected" : "offline";
    const model = currentModel(snapshot, config);
    const effort = currentReasoningEffort(snapshot, config);
    const threads = this.state.listedThreads;
    return {
      connected: this.connection.isConnected(),
      status: this.state.status,
      statusState,
      historyOpen,
      statusPanelOpen,
      runtimeOpen,
      planActive: this.state.requestedCollaborationMode === "plan",
      fastActive: currentServiceTier(snapshot, config) === "fast",
      runtimeSummary: runtimeSummaryLabel(model, effort),
      runtimeTitle: `Model: ${model ?? "(from default)"}; Effort: ${effort ?? "(from default)"}`,
      runtimeAriaLabel: `Runtime: ${model ?? "default"} ${effort ?? "default"}`,
      runtimeEmphasized: this.state.requestedModel.kind !== "default" || this.state.requestedReasoningEffort.kind !== "default",
      context: context ? { ...context, label: compactContextLabel(context.percent, context.label) } : null,
      rateLimit: limit,
      configSections: effectiveConfigSections(snapshot, this.plugin.vaultPath),
      openPanel: historyOpen ? "history" : runtimeOpen ? "runtime" : statusPanelOpen ? "status" : null,
      threads: threads.map((thread) => {
        const threadId = thread.id;
        return {
          title: getThreadTitle(thread),
          threadId,
          selected: threadId === this.state.activeThreadId,
          disabled: this.state.busy && threadId !== this.state.activeThreadId,
          canArchive: true,
          rename: this.threadRename.editState(threadId),
        };
      }),
      modelChoices: this.modelToolbarChoices(),
      effortChoices: this.effortToolbarChoices(),
      connectLabel: this.connection.isConnected() ? "Reconnect" : "Connect",
      diagnostics: this.connectionDiagnosticRows(),
    };
  }

  private async reconnectFromToolbar(): Promise<void> {
    const threadId = this.state.activeThreadId;
    this.state.openDetails.delete("status-panel");
    this.connection.reconnect();
    this.client = null;
    this.state.busy = false;
    this.state.activeTurnId = null;
    this.state.approvals = [];
    this.state.pendingUserInputs = [];
    this.state.userInputDrafts.clear();
    this.setStatus("Reconnecting...");
    this.render();

    await this.ensureConnected();
    if (!threadId || !this.client) return;

    try {
      await this.resumeThread(threadId);
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private modelToolbarChoices(): ToolbarChoice[] {
    const snapshot = this.runtimeSnapshot();
    const models = sortedAvailableModels(this.state.availableModels);
    const choices: ToolbarChoice[] = [
      {
        label: "Default",
        selected: this.state.requestedModel.kind !== "set",
        onClick: () => this.setRequestedModelFromUi(null),
      },
    ];
    choices.push(
      ...models.slice(0, 12).map((model) => ({
        label: model.model,
        selected: currentModel(snapshot) === model.model,
        onClick: () => this.setRequestedModelFromUi(model.model),
      })),
    );
    if (models.length === 0) {
      choices.push({
        label: "No model list available.",
        disabled: true,
        onClick: () => undefined,
      });
    }
    return choices;
  }

  private effortToolbarChoices(): ToolbarChoice[] {
    const snapshot = this.runtimeSnapshot();
    return [
      {
        label: "Default",
        selected: this.state.requestedReasoningEffort.kind !== "set",
        onClick: () => this.setRequestedReasoningEffortFromUi(null),
      },
      ...supportedReasoningEfforts(snapshot).map((effort) => ({
        label: effort,
        selected: currentReasoningEffort(snapshot) === effort,
        onClick: () => this.setRequestedReasoningEffortFromUi(effort),
      })),
    ];
  }

  private toggleHistoryPanel(): void {
    if (this.state.openDetails.has("history")) {
      this.state.openDetails.delete("history");
    } else {
      this.state.openDetails.delete("status-panel");
      this.state.runtimePicker = null;
      this.state.openDetails.add("history");
    }
    this.scheduleRender();
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    if (!this.hasOpenToolbarPanel()) return;

    const target = event.target;
    if (target instanceof Element) {
      const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
      if (insideToolbarPanel && this.containerEl.contains(insideToolbarPanel)) return;
    }

    this.closeToolbarPanel();
  }

  private hasOpenToolbarPanel(): boolean {
    return this.state.openDetails.has("history") || this.state.openDetails.has("status-panel") || this.state.runtimePicker !== null;
  }

  private closeToolbarPanel(): void {
    if (!this.hasOpenToolbarPanel()) return;

    this.state.openDetails.delete("history");
    this.state.openDetails.delete("status-panel");
    this.state.runtimePicker = null;
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.scheduledRenderTimer !== null) return;
    this.scheduledRenderTimer = window.setTimeout(() => {
      this.scheduledRenderTimer = null;
      this.render();
    }, 50);
  }

  private renderShell(root: HTMLElement): void {
    root.empty();
    root.addClass("codex-panel");
    this.toolbarEl = root.createDiv({ cls: "codex-panel__toolbar" });
    const body = root.createDiv({ cls: "codex-panel__body" });
    this.configSlotEl = body.createDiv({ cls: "codex-panel__slot codex-panel__slot--config" });
    this.messagesSlotEl = body.createDiv({ cls: "codex-panel__slot codex-panel__slot--messages" });
    this.composerSlotEl = body.createDiv({ cls: "codex-panel__slot codex-panel__slot--composer" });
  }

  private toggleStatusPanel(): void {
    if (this.state.openDetails.has("status-panel")) {
      this.state.openDetails.delete("status-panel");
    } else {
      this.state.openDetails.delete("history");
      this.state.runtimePicker = null;
      this.state.openDetails.add("status-panel");
    }
    this.scheduleRender();
  }

  private statusSummaryLines(): string[] {
    const snapshot = this.runtimeSnapshot();
    const context = contextSummary(snapshot);
    const config = configRecord(this.state.effectiveConfig);
    const model = currentModel(snapshot, config) ?? "(from default)";
    const effort = currentReasoningEffort(snapshot, config);
    return [
      "Session status",
      `Status: ${this.state.status}`,
      `Thread: ${this.state.activeThreadId ?? "(none)"}`,
      `Turn: ${this.state.activeTurnId ?? "(none)"}`,
      `Mode: ${this.collaborationModeLabel()}`,
      `Runtime: ${model}${effort ? ` ${effort}` : ""}, fast ${fastModeLabel(snapshot, config)}`,
      `Connection: ${this.connection.isConnected() ? "connected" : "offline"}`,
      context ? context.title : "Context: not available",
    ];
  }

  private modelStatusLines(): string[] {
    const snapshot = this.runtimeSnapshot();
    const config = configRecord(this.state.effectiveConfig);
    return [
      `Model: ${currentModel(snapshot, config) ?? "(from default)"}`,
      `Override: ${runtimeOverrideLabel(this.state.requestedModel)}`,
      `Provider: ${statusValue(config.model_provider, "(from default)")}`,
      `Effort: ${currentReasoningEffort(snapshot, config) ?? "(from default)"}`,
      `Mode: ${this.collaborationModeLabel()}`,
      `Service tier: ${serviceTierLabel(snapshot, config)}`,
    ];
  }

  private effortStatusLines(): string[] {
    const snapshot = this.runtimeSnapshot();
    const config = configRecord(this.state.effectiveConfig);
    return [
      `Effort: ${currentReasoningEffort(snapshot, config) ?? "(from default)"}`,
      `Override: ${runtimeOverrideLabel(this.state.requestedReasoningEffort)}`,
      `Supported: ${supportedReasoningEfforts(snapshot).join(", ")}`,
    ];
  }

  private connectionDiagnosticRows() {
    return connectionDiagnosticRows({
      connected: this.connection.isConnected(),
      configuredCommand: this.plugin.settings.codexPath,
      initializeResponse: this.state.initializeResponse,
      activeThreadCliVersion: this.state.activeThreadCliVersion,
      compatibility: this.state.appServerCompatibility,
    });
  }

  private connectionDiagnosticLines(): string[] {
    return connectionDiagnosticLines(this.connectionDiagnosticRows());
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.requestedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return {
      effectiveConfig: this.state.effectiveConfig,
      activeThreadId: this.state.activeThreadId,
      activeModel: this.state.activeModel,
      activeServiceTier: this.state.activeServiceTier,
      requestedModel: this.state.requestedModel,
      requestedReasoningEffort: this.state.requestedReasoningEffort,
      requestedCollaborationMode: this.state.requestedCollaborationMode,
      requestedServiceTier: this.state.requestedServiceTier,
      tokenUsage: this.state.tokenUsage,
      rateLimit: this.state.rateLimit,
      displayItems: this.state.displayItems,
      availableModels: this.state.availableModels,
    };
  }

  private renderPendingRequestMessage(parent: HTMLElement): void {
    renderPendingRequestMessage(
      parent,
      this.state.approvals,
      this.state.pendingUserInputs,
      {
        values: this.state.userInputDrafts,
        draftKey: userInputDraftKey,
        otherDraftKey: userInputOtherDraftKey,
      },
      this.state.openDetails,
      {
        resolveApproval: (approval, action) => void this.resolveApproval(approval, action),
        resolveUserInput: (input) => void this.resolveUserInput(input),
        cancelUserInput: (input) => void this.cancelUserInput(input),
      },
    );
  }

  private answersForUserInput(input: PendingUserInput): Record<string, string> {
    return Object.fromEntries(
      input.params.questions.map((question) => [
        question.id,
        this.state.userInputDrafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
      ]),
    );
  }

  private async archiveThread(threadId: string): Promise<void> {
    if (this.state.busy) {
      this.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
      return;
    }
    if (!this.client) return;
    try {
      await this.client.archiveThread(threadId);
      if (this.state.activeThreadId === threadId) {
        clearActiveThreadState(this.state);
        this.threadRename.resetThreadTurnPresence(false);
      }
      await this.refreshThreads();
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async forkThread(threadId: string): Promise<void> {
    if (this.state.busy) {
      this.addSystemMessage("Finish or interrupt the current turn before forking threads.");
      return;
    }
    await this.ensureConnected();
    if (!this.client) return;

    try {
      const response = await this.client.forkThread(threadId, this.plugin.vaultPath);
      this.state.activeThreadId = response.thread.id;
      this.state.activeThreadCwd = response.cwd ?? response.thread.cwd ?? this.plugin.vaultPath;
      this.state.activeTurnId = null;
      this.state.activeModel = response.model ?? null;
      this.state.activeServiceTier = response.serviceTier ?? null;
      this.state.activeThreadCliVersion = response.thread.cliVersion ?? null;
      this.state.tokenUsage = null;
      this.state.displayItems = [];
      this.state.historyCursor = null;
      this.threadRename.resetThreadTurnPresence(false);
      this.forceMessagesToBottom();
      await this.refreshThreads();
      await this.history.loadLatest(response.thread.id);
      if (this.state.displayItems.length === 0) {
        this.state.displayItems.push(this.systemItem(`Forked thread ${response.thread.id}`));
        this.forceMessagesToBottom();
      }
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private forceMessagesToBottom(): void {
    this.state.messagesPinnedToBottom = true;
    this.forceScrollMessagesToBottomOnNextRender = true;
  }

  private renderMessages(parent: HTMLElement): void {
    const messagesEl = parent.querySelector<HTMLElement>(".codex-panel__messages") ?? parent.createDiv({ cls: "codex-panel__messages" });
    messagesEl.onscroll = () => {
      this.state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    };
    const wasNearBottom = isNearScrollBottom(messagesEl);
    const shouldScrollToBottom = this.forceScrollMessagesToBottomOnNextRender || wasNearBottom;
    const scrollAnchor = shouldScrollToBottom ? null : captureScrollAnchor(messagesEl);
    this.forceScrollMessagesToBottomOnNextRender = false;
    this.state.messagesPinnedToBottom = shouldScrollToBottom;

    const blocks = messageRenderBlocks({
      activeThreadId: this.state.activeThreadId,
      activeTurnId: this.state.activeTurnId,
      historyCursor: this.state.historyCursor,
      loadingHistory: this.state.loadingHistory,
      busy: this.state.busy,
      displayItems: this.state.displayItems,
      workspaceRoot: this.state.activeThreadCwd ?? this.plugin.vaultPath,
      openDetails: this.state.openDetails,
      onDetailsToggle: () => {
        window.requestAnimationFrame(() => {
          this.state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
        });
      },
      loadOlderTurns: () => void this.history.loadOlder(),
      renderMarkdown: (element, text) => this.renderMarkdownMessage(element, text),
      renderTextWithWikiLinks: (element, text) => this.renderTextWithWikiLinks(element, text),
      pendingRequestsSignature: this.pendingRequestsSignature(),
      renderPendingRequests: () => this.createPendingRequestsElement(),
    });
    const existing = new Map<string, HTMLElement>();
    messagesEl.querySelectorAll<HTMLElement>(":scope > [data-codex-panel-block-key]").forEach((element) => {
      const key = element.dataset.codexPanelBlockKey;
      if (key) existing.set(key, element);
    });

    const seen = new Set<string>();
    for (const block of blocks) {
      const current = existing.get(block.key);
      let element = current;
      if (!element || this.blockSignatures.get(block.key) !== block.signature) {
        element = block.render();
        element.dataset.codexPanelBlockKey = block.key;
        element.dataset.codexPanelBlockSignature = shortSignature(block.signature);
        this.blockSignatures.set(block.key, block.signature);
        if (current) {
          current.replaceWith(element);
        }
      }
      messagesEl.appendChild(element);
      seen.add(block.key);
    }

    for (const [key, element] of existing) {
      if (!seen.has(key)) {
        this.blockSignatures.delete(key);
        element.remove();
      }
    }

    window.requestAnimationFrame(() => {
      if (shouldScrollToBottom) {
        messagesEl.scrollTop = bottomScrollTop(messagesEl);
      } else {
        restoreScrollAnchor(messagesEl, scrollAnchor);
      }
      this.state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    });
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
    void MarkdownRenderer.render(this.app, text, parent, sourcePath, this).then(() => {
      this.bindRenderedWikiLinks(parent, sourcePath);
      this.scrollMarkdownMessageIntoPinnedBottom(parent);
    });
  }

  private pendingRequestsSignature(): string {
    if (this.state.approvals.length === 0 && this.state.pendingUserInputs.length === 0) return "";
    return JSON.stringify({
      approvals: this.state.approvals.map((approval) => ({ id: approval.requestId, method: approval.method })),
      inputs: this.state.pendingUserInputs.map((input) => ({
        id: input.requestId,
        questions: input.params.questions.map((question) => ({
          id: question.id,
          header: question.header,
          question: question.question,
          options: question.options?.map((option) => option.label) ?? null,
        })),
      })),
      drafts: Array.from(this.state.userInputDrafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
    });
  }

  private createPendingRequestsElement(): HTMLElement | null {
    if (this.state.approvals.length === 0 && this.state.pendingUserInputs.length === 0) return null;
    const container = createDiv();
    this.renderPendingRequestMessage(container);
    return container.firstElementChild as HTMLElement | null;
  }

  private scrollMarkdownMessageIntoPinnedBottom(parent: HTMLElement): void {
    if (!this.state.messagesPinnedToBottom) return;
    const messagesEl = parent.closest<HTMLElement>(".codex-panel__messages");
    if (!messagesEl) return;
    window.requestAnimationFrame(() => {
      if (!this.state.messagesPinnedToBottom) return;
      messagesEl.scrollTop = bottomScrollTop(messagesEl);
      this.state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    });
  }

  private bindRenderedWikiLinks(parent: HTMLElement, sourcePath: string): void {
    parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
      link.addClass("codex-panel__wikilink");
      link.onclick = (event) => {
        event.preventDefault();
        const target = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent ?? "";
        if (target.trim().length > 0) {
          void this.app.workspace.openLinkText(target, sourcePath, false);
        }
      };
    });
  }

  private renderTextWithWikiLinks(parent: HTMLElement, text: string): void {
    renderInlineWikiLinks(parent, text, (target) => {
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
      void this.app.workspace.openLinkText(target, sourcePath, false);
    });
  }

  private renderComposer(parent: HTMLElement): void {
    if (this.composer && parent.contains(this.composer)) {
      return;
    }

    const elements = renderComposerShell(parent, this.viewId, this.state.composerDraft, this.state.busy, {
      onInput: () => {
        this.state.composerDraft = this.composer?.value ?? "";
        this.state.composerSuggestionsDismissedSignature = null;
        this.updateComposerSuggestions();
        this.syncComposerControls();
      },
      onUpdateSuggestions: () => this.updateComposerSuggestions(),
      onKeydown: (event) => {
        if (this.handleComposerSuggestionKeydown(event)) {
          return;
        }
        if (isComposerSendKey(event, this.plugin.settings.sendShortcut)) {
          event.preventDefault();
          void this.submitComposerAction();
        }
      },
      onNewThread: () => void this.startNewThread(),
      onSendOrInterrupt: () => void this.submitComposerAction(),
      onSuggestionHover: (index) => {
        if (this.state.composerSuggestSelected === index) return;
        this.state.composerSuggestSelected = index;
        this.renderComposerSuggestions();
      },
      onSuggestionInsert: (suggestion) => this.insertComposerSuggestion(suggestion),
    });
    this.composer = elements.composer;
    this.composerSuggestEl = elements.suggestions;
    this.updateComposerSuggestions();
  }

  private syncComposerControls(): void {
    const canInterrupt = this.state.busy && Boolean(this.state.activeThreadId && this.state.activeTurnId);
    syncComposerControlElements(this.composerSlotEl, this.composer, this.state.busy, canInterrupt);
  }

  private handleComposerSuggestionKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (this.state.composerSuggestions.length === 0) return false;

    const direction = composerSuggestionNavigationDirection(event);
    if (direction) {
      event.preventDefault();
      this.state.composerSuggestSelected = nextComposerSuggestionIndex(
        this.state.composerSuggestSelected,
        this.state.composerSuggestions.length,
        direction,
      );
      this.renderComposerSuggestions();
      return true;
    }
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertComposerSuggestion(this.state.composerSuggestions[this.state.composerSuggestSelected]);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.dismissComposerSuggestions();
      return true;
    }

    return false;
  }

  private updateComposerSuggestions(): void {
    if (!this.composer) {
      this.clearComposerSuggestions();
      return;
    }

    const cursor = this.composer.selectionStart;
    const signature = this.composerSuggestionSignature();
    if (this.state.composerSuggestionsDismissedSignature === signature) {
      this.state.composerSuggestions = [];
      this.renderComposerSuggestions();
      return;
    }
    const beforeCursor = this.composer.value.slice(0, cursor);
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      this.state.availableSkills,
      this.state.listedThreads,
    );

    this.state.composerSuggestions = suggestions;
    if (this.state.composerSuggestSelected >= this.state.composerSuggestions.length) {
      this.state.composerSuggestSelected = 0;
    }
    this.renderComposerSuggestions();
  }

  private renderComposerSuggestions(): void {
    renderComposerSuggestions(
      this.composerSuggestEl,
      this.composer,
      this.viewId,
      this.state.composerSuggestions,
      this.state.composerSuggestSelected,
      {
        onSuggestionHover: (index) => {
          if (this.state.composerSuggestSelected === index) return;
          this.state.composerSuggestSelected = index;
          this.renderComposerSuggestions();
        },
        onSuggestionInsert: (suggestion) => this.insertComposerSuggestion(suggestion),
      },
    );
  }

  private insertComposerSuggestion(suggestion: ComposerSuggestion | undefined): void {
    if (!this.composer || !suggestion) return;

    const cursor = this.composer.selectionStart;
    const value = this.composer.value;
    const insertion = applyComposerSuggestionInsertion(value, cursor, suggestion);

    this.state.composerDraft = insertion.value;
    this.composer.value = insertion.value;
    syncComposerHeight(this.composer);
    this.composer.focus();
    this.composer.setSelectionRange(insertion.cursor, insertion.cursor);
    this.clearComposerSuggestions();
  }

  private clearComposerSuggestions(): void {
    this.state.composerSuggestSelected = 0;
    this.state.composerSuggestions = [];
    this.composer?.setAttr("aria-expanded", "false");
    this.composer?.removeAttribute("aria-activedescendant");
    this.composerSuggestEl?.empty();
    this.composerSuggestEl?.hide();
  }

  private dismissComposerSuggestions(): void {
    this.state.composerSuggestionsDismissedSignature = this.composerSuggestionSignature();
    this.clearComposerSuggestions();
  }

  private composerSuggestionSignature(): string | null {
    if (!this.composer) return null;
    return composerSuggestionSignature(this.composer.value, this.composer.selectionStart);
  }

  private noteCandidates(): NoteCandidate[] {
    if (!this.noteCandidatesCache) {
      this.noteCandidatesCache = this.app.vault.getMarkdownFiles().map((file) => ({
        basename: file.basename,
        path: file.path,
        mtime: file.stat.mtime,
      }));
    }
    return this.noteCandidatesCache;
  }

  private codexInput(text: string): UserInput[] {
    return userInputWithWikiLinkMentions(text, (target) => this.resolveWikiLinkMention(target));
  }

  private resolveWikiLinkMention(target: string): { name: string; path: string } | null {
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    if (linkedFile?.path) return { name: linkedFile.basename, path: linkedFile.path };

    const directPath = target.endsWith(".md") ? target : `${target}.md`;
    const abstractFile = this.app.vault.getAbstractFileByPath(directPath);
    if (abstractFile instanceof TFile) return { name: abstractFile.basename, path: abstractFile.path };
    return null;
  }

  private registerNoteIndexInvalidation(): void {
    if (this.noteEventsRegistered) return;
    this.noteEventsRegistered = true;
    const invalidate = () => {
      this.noteCandidatesCache = null;
    };
    this.registerEvent(this.app.vault.on("create", invalidate));
    this.registerEvent(this.app.vault.on("delete", invalidate));
    this.registerEvent(this.app.vault.on("rename", invalidate));
    this.registerEvent(this.app.vault.on("modify", invalidate));
  }
}

function statusValue(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value, fallback);
}

function jsonPreview(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}
