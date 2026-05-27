import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager, StaleConnectionError } from "../../app-server/connection-manager";
import { reportedServiceTier, serviceTierRequestValue, type ServiceTier } from "../../app-server/service-tier";
import type { ApprovalAction, PendingApproval } from "./approvals/model";
import type { SlashCommandName } from "./composer/slash-commands";
import { parseSlashCommand } from "./composer/suggestions";
import { VIEW_TYPE_CODEX_PANEL } from "../../constants";
import { createSystemItem } from "./display/system";
import { fileMentionsFromInput } from "./display/thread-items";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
import type { Model } from "../../generated/app-server/v2/Model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ThreadResumeResponse } from "../../generated/app-server/v2/ThreadResumeResponse";
import type { ThreadSettingsUpdateParams } from "../../generated/app-server/v2/ThreadSettingsUpdateParams";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import {
  collaborationModeLabel as formatCollaborationModeLabel,
  collaborationModeToggleMessage,
  nextCollaborationMode,
} from "../../runtime/collaboration-mode";
import { ChatController } from "./chat-controller";
import { connectionDiagnosticSections, diagnosticAlertLevel } from "./diagnostics";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../../runtime/view";
import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  defaultRuntimeOverride,
  requestedTurnRuntimeSettings,
  resetRuntimeOverride,
  runtimeOverridePayload,
  runtimeOverrideLabel,
  runtimeSummaryLabel,
  serviceTierLabel,
  setRuntimeOverride,
  supportedReasoningEfforts,
  type RuntimeSnapshot,
} from "../../runtime/state";
import { readRuntimeConfig } from "../../runtime/config";
import { sortedAvailableModels } from "../../runtime/model";
import { compactContextLabel, modelOverrideMessage, reasoningEffortOverrideMessage } from "../../runtime/settings";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult } from "./slash-commands";
import type { ThreadReferenceInput } from "./slash-commands";
import { mcpStatusLines } from "./mcp-status";
import { ChatSessionController } from "./chat-session-controller";
import { statusValue, usageLimitStatusLines } from "./status-lines";
import { ThreadHistoryLoader } from "./thread-history";
import { ThreadRenameController } from "./thread-rename";
import { pendingRequestsSignature as requestStateSignature, userInputDraftKey, userInputOtherDraftKey } from "./request-state";
import type { CodexPanelSettings } from "../../settings/model";
import { questionDefaultAnswer, type PendingUserInput } from "./user-input/model";
import { ChatComposerController } from "./chat-composer-controller";
import { attachHookRunsToTurn } from "./hook-display";
import { clearActiveThreadState, clearConnectionScopedState, createChatState, type ChatState } from "./chat-state";
import { codexPanelDisplayTitle, explicitThreadName, getThreadTitle, upsertThread } from "../../domain/threads/model";
import {
  referencedThreadDisplay,
  referencedThreadPrompt,
  referencedThreadStatus,
  referencedThreadTurns,
  REFERENCED_THREAD_TURN_LIMIT,
  type ReferencedThreadDisplay,
} from "../../domain/threads/reference";
import { renderPendingRequestMessage } from "./ui/pending-request-message";
import { renderToolbar, type ToolbarChoice, type ToolbarViewModel } from "./ui/toolbar";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { ChatMessageRenderer, type ChatMessageScrollIntent } from "./chat-message-renderer";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { SharedSessionMetadata } from "../../runtime/shared-app-server-state";
import { ChatThreadActionController } from "./thread-actions";
import { unmountReactRoot } from "../../shared/ui/react-root";

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
  refreshThreadList(fetchThreads: () => Promise<Thread[]>): Promise<Thread[]>;
  cachedThreadList(): Thread[] | null;
  publishSessionMetadata(metadata: SharedSessionMetadata): void;
  cachedSessionMetadata(): SharedSessionMetadata | null;
}

interface RestoredThreadState {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export class CodexChatView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly connection: ConnectionManager;
  private readonly controller: ChatController;
  private readonly session: ChatSessionController;
  private readonly history: ThreadHistoryLoader;
  private readonly threadActions: ChatThreadActionController;
  private readonly threadRename: ThreadRenameController;
  private readonly state: ChatState = createChatState();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly composerController: ChatComposerController;
  private readonly messageRenderer: ChatMessageRenderer;
  private readonly blockSignatures = new Map<string, string>();
  private toolbarEl: HTMLElement | null = null;
  private configSlotEl: HTMLElement | null = null;
  private messagesSlotEl: HTMLElement | null = null;
  private composerSlotEl: HTMLElement | null = null;
  private scheduledRestoredThreadHydrationTimer: number | null = null;
  private scheduledRenderTimer: number | null = null;
  private scheduledDiagnosticsTimer: number | null = null;
  private archiveConfirmThreadId: string | null = null;
  private connectingPromise: Promise<void> | null = null;
  private connectionGeneration = 0;
  private resumeGeneration = 0;
  private restoredThread: RestoredThreadState | null = null;
  private restoredThreadLoading: Promise<void> | null = null;
  private opened = false;
  private closing = false;
  private nextMessageScrollIntent: ChatMessageScrollIntent = "auto";
  private scheduledSessionWarmupTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexChatHost,
  ) {
    super(leaf);
    this.messageRenderer = new ChatMessageRenderer({
      app: this.app,
      owner: this,
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      blockSignatures: this.blockSignatures,
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
      renderPendingRequests: () => this.createPendingRequestsElement(),
    });
    this.composerController = new ChatComposerController({
      app: this.app,
      state: this.state,
      viewId: this.viewId,
      sendShortcut: () => this.plugin.settings.sendShortcut,
      canInterrupt: () => this.state.busy && Boolean(this.state.activeThreadId && this.state.activeTurnId),
      composerPlaceholder: () => this.composerPlaceholder(),
      currentModelForSuggestions: () => currentModel(this.runtimeSnapshot()),
      renderIfDetached: () => {
        this.render();
      },
      onDraftChange: () => {
        this.plugin.refreshThreadsViewLiveState();
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
        this.invalidateResumeWork();
        this.setStatus("Codex app-server stopped.");
        clearConnectionScopedState(this.state);
        this.threadRename.resetThreadTurnPresence(false);
        this.client = null;
        this.plugin.refreshThreadsViewLiveState();
        this.render();
      },
    });
    this.controller = new ChatController(this.state, {
      refreshThreads: () => {
        void this.refreshThreads();
      },
      refreshSkills: (forceReload) => void this.refreshSkills(forceReload),
      publishSessionMetadata: () => {
        this.publishSessionMetadataSnapshot();
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
        this.session.recordMcpStartupStatus(name, status, message);
        this.scheduleRender();
      },
      respondToServerRequest: (requestId, result) => this.respondToServerRequest(requestId, result),
      rejectServerRequest: (requestId, code, message) => this.rejectServerRequest(requestId, code, message),
    });
    this.session = new ChatSessionController({
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.connection.currentClient(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
      forceMessagesToBottom: () => {
        this.queueMessagesBottomScroll();
      },
    });
    this.history = new ThreadHistoryLoader({
      state: this.state,
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
      state: this.state,
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
    this.threadRename = new ThreadRenameController({
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      settings: () => this.plugin.settings,
      ensureConnected: () => this.ensureConnected(),
      currentClient: () => this.connection.currentClient(),
      refreshThreads: () => this.refreshThreads(),
      render: () => {
        this.render();
      },
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.plugin.notifyThreadRenamed(threadId, name);
      },
    });
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  override getDisplayText(): string {
    return codexPanelDisplayTitle(this.state.activeThreadId, this.state.listedThreads, this.restoredThread?.title ?? null);
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override getState(): Record<string, unknown> {
    const threadId = this.state.activeThreadId;
    if (!threadId) return { version: 1 };

    const threadTitle = this.restoredThread?.title ?? this.activeThreadTitle();
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
      this.restoredThread = null;
      this.clearDeferredRestoredThreadHydration();
      this.scheduleDeferredSessionWarmup();
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

  applyThreadListSnapshot(threads: Thread[]): void {
    this.session.applyThreadList(threads);
    this.refreshTabHeader();
    this.render();
  }

  applySessionMetadataSnapshot(metadata: SharedSessionMetadata): void {
    this.session.applySessionMetadata(metadata);
    this.render();
  }

  applyAvailableModelsSnapshot(models: Model[]): void {
    this.state.availableModels = models;
    this.render();
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return {
      viewId: this.viewId,
      threadId: this.closing ? null : this.state.activeThreadId,
      busy: this.state.busy,
      activeTurnId: this.state.activeTurnId,
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
    this.state.listedThreads = this.state.listedThreads.map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return { ...thread, name };
    });
    if (this.restoredThread?.threadId === threadId && (this.restoredThread.title !== name || this.restoredThread.explicitName !== name)) {
      this.restoredThread = { ...this.restoredThread, title: name, explicitName: name };
      changed = true;
    }
    const activeThreadChanged = this.state.activeThreadId === threadId || this.restoredThread?.threadId === threadId;
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
    this.scheduleDeferredSessionWarmup();
    this.scheduleDeferredRestoredThreadHydration();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    this.closing = true;
    this.connectionGeneration += 1;
    this.invalidateResumeWork();
    this.connectingPromise = null;
    this.clearDeferredRestoredThreadHydration();
    this.clearDeferredSessionWarmup();
    if (this.scheduledRenderTimer !== null) {
      this.containerEl.win.clearTimeout(this.scheduledRenderTimer);
      this.scheduledRenderTimer = null;
    }
    this.clearDeferredDiagnostics();
    unmountReactRoot(this.toolbarEl);
    unmountReactRoot(this.messagesSlotEl);
    unmountReactRoot(this.composerSlotEl);
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
    if (this.connection.isConnected()) {
      this.client = this.connection.currentClient();
      return;
    }
    if (this.connectingPromise) return this.connectingPromise;

    const generation = this.connectionGeneration;
    const promise = this.initializeConnection(generation);
    this.connectingPromise = promise;
    try {
      await promise;
    } finally {
      if (this.connectingPromise === promise) {
        this.connectingPromise = null;
      }
    }
  }

  private async initializeConnection(generation: number): Promise<void> {
    this.setStatus("Starting Codex app-server...");
    try {
      this.state.initializeResponse = await this.connection.connect();
      if (this.isStaleConnectionGeneration(generation)) return;
      this.client = this.connection.currentClient();
      if (!this.client) throw new Error("Codex app-server connection did not initialize.");
      const metadata = await this.session.refreshSessionMetadata();
      if (this.isStaleConnectionGeneration(generation)) return;
      if (metadata) this.plugin.publishSessionMetadata(metadata);
      await this.loadSharedThreadList();
      if (this.isStaleConnectionGeneration(generation)) return;
      this.scheduleDeferredDiagnostics();
      this.refreshTabHeader();
      this.setStatus("Connected.");
    } catch (error) {
      if (this.isStaleConnectionGeneration(generation)) return;
      if (error instanceof StaleConnectionError) return;
      this.setStatus("Connection failed.");
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      new Notice("Codex app-server connection failed.");
    }
    if (!this.isStaleConnectionGeneration(generation)) {
      this.scheduleRender();
    }
  }

  private isStaleConnectionGeneration(generation: number): boolean {
    return generation !== this.connectionGeneration;
  }

  async startNewThread(): Promise<void> {
    if (this.state.busy) return;

    this.invalidateResumeWork();
    this.restoredThread = null;
    this.clearDeferredRestoredThreadHydration();
    clearActiveThreadState(this.state);
    this.threadRename.resetThreadTurnPresence(false);
    this.state.openDetails.delete("history");
    this.setStatus("New chat.");
    this.queueMessagesBottomScroll();
    this.plugin.refreshThreadsViewLiveState();
    this.notifyActiveThreadIdentityChanged();
    this.render();
    this.focusComposer();
  }

  private async refreshThreads(): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    try {
      await this.loadSharedThreadList();
      const metadata = await this.session.refreshSessionMetadata();
      if (metadata) this.plugin.publishSessionMetadata(metadata);
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
    await this.session.refreshCapabilityDiagnostics();
    this.publishSessionMetadataSnapshot();
    this.render();
  }

  private async refreshSkills(forceReload = false): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    await this.session.refreshSkills(forceReload);
    this.publishSessionMetadataSnapshot();
    this.render();
  }

  private async resumeThread(threadId: string): Promise<void> {
    if (this.state.busy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    const resumeGeneration = this.beginResumeWork();
    await this.ensureConnected();
    if (!this.client || this.isStaleResumeWork(resumeGeneration)) return;

    try {
      const response = await this.client.resumeThread(threadId, this.plugin.vaultPath);
      if (this.isStaleResumeWork(resumeGeneration)) return;
      this.applyResumedThread(response);
      await this.history.loadLatest(response.thread.id);
      if (this.isStaleResumeWork(resumeGeneration)) return;
      if (this.state.displayItems.length === 0) {
        this.state.displayItems.push(this.systemItem(`Resumed thread ${response.thread.id}`));
        this.queueMessagesBottomScroll();
        this.render();
      }
      this.plugin.refreshThreadsViewLiveState();
    } catch (error) {
      if (this.isStaleResumeWork(resumeGeneration)) return;
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

  private applyResumedThread(response: ThreadResumeResponse): void {
    this.state.activeThreadId = response.thread.id;
    this.state.activeThreadCwd = response.cwd;
    this.state.activeTurnId = null;
    this.state.activeModel = response.model;
    this.state.activeReasoningEffort = response.reasoningEffort;
    this.state.activeServiceTier = reportedServiceTier(response.serviceTier);
    this.state.activeApprovalsReviewer = response.approvalsReviewer;
    this.state.activeThreadCreationCliVersion = response.thread.cliVersion;
    this.state.tokenUsage = null;
    this.state.displayItems = [this.systemItem("Loading thread...")];
    this.state.turnDiffs.clear();
    this.state.historyCursor = null;
    this.state.listedThreads = upsertThread(this.state.listedThreads, response.thread);
    this.restoredThread = null;
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
    const threads = await this.plugin.refreshThreadList(() => this.session.loadThreadList());
    this.session.applyThreadList(threads);
  }

  private publishSessionMetadataSnapshot(): void {
    this.plugin.publishSessionMetadata(this.session.sessionMetadataSnapshot());
  }

  private applyCachedSharedAppServerState(): void {
    const threads = this.plugin.cachedThreadList();
    if (threads) this.session.applyThreadList(threads);
    const metadata = this.plugin.cachedSessionMetadata();
    if (metadata) this.session.applySessionMetadata(metadata);
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

    if (this.state.busy) {
      await this.steerCurrentTurn(text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!this.state.activeThreadId) {
        const threadResponse = await this.session.startThread();
        if (!threadResponse) return;
        this.notifyActiveThreadIdentityChanged();
        this.threadRename.resetThreadTurnPresence(false);
      }
      const activeThreadId = this.state.activeThreadId;
      if (!activeThreadId) return;
      if (!(await this.applyPendingThreadSettings())) return;

      const codexInput = codexInputOverride ?? this.composerController.codexInput(text);
      const mentionedFiles = fileMentionsFromInput(codexInput);
      optimisticUserId = `local-user-${String(Date.now())}`;
      this.state.displayItems.push({
        id: optimisticUserId,
        kind: "message",
        role: "user",
        text,
        copyText: text,
        ...(referencedThread ? { referencedThread } : {}),
        ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
        markdown: true,
      });
      this.state.pendingTurnStart = { anchorItemId: optimisticUserId, promptSubmitHookItemIds: [] };
      this.queueMessagesBottomScroll();
      this.composerController.setDraft("");
      this.state.busy = true;
      this.render();

      const response = await client.startTurn(activeThreadId, this.plugin.vaultPath, codexInput);
      this.state.activeTurnId = response.turn.id;
      const pendingTurnStart = this.state.pendingTurnStart as typeof this.state.pendingTurnStart | null;
      this.state.displayItems = this.state.displayItems.map((item) =>
        item.id === optimisticUserId ? { ...item, turnId: response.turn.id } : item,
      );
      if (pendingTurnStart) {
        this.state.displayItems = attachHookRunsToTurn(
          this.state.displayItems,
          response.turn.id,
          pendingTurnStart.promptSubmitHookItemIds,
          pendingTurnStart.anchorItemId,
        );
        this.state.pendingTurnStart = null;
      }
      this.setStatus("Turn running...");
    } catch (error) {
      this.state.busy = false;
      if (optimisticUserId) this.state.displayItems = this.state.displayItems.filter((item) => item.id !== optimisticUserId);
      if (this.state.pendingTurnStart) {
        const hookIds = new Set(this.state.pendingTurnStart.promptSubmitHookItemIds);
        this.state.displayItems = this.state.displayItems.filter((item) => !hookIds.has(item.id));
        this.state.pendingTurnStart = null;
      }
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
    if (!this.client || !this.state.activeThreadId || !this.state.activeTurnId) {
      this.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const threadId = this.state.activeThreadId;
    const expectedTurnId = this.state.activeTurnId;
    const codexInput = codexInputOverride ?? this.composerController.codexInput(text);
    const mentionedFiles = fileMentionsFromInput(codexInput);

    this.composerController.setDraft("", { clearSuggestions: true });
    this.syncComposerControls();

    try {
      await this.client.steerTurn(threadId, expectedTurnId, codexInput);
      this.state.displayItems.push({
        id: `local-steer-${String(Date.now())}`,
        kind: "message",
        role: "user",
        text,
        copyText: text,
        turnId: expectedTurnId,
        ...(referencedThread ? { referencedThread } : {}),
        ...(mentionedFiles.length > 0 ? { mentionedFiles } : {}),
        markdown: true,
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

    this.state.requestedCollaborationMode = "default";
    this.state.runtimePicker = null;
    await this.sendTurnText("Please implement this plan.");
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
    const draft = this.composerController.trimmedDraft;
    if (this.state.busy && this.state.activeThreadId && this.state.activeTurnId && draft.length === 0) {
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
      busy: this.state.busy,
      toggleFastMode: () => this.toggleFastMode(),
      toggleCollaborationMode: () => this.toggleCollaborationMode(),
      toggleAutoReview: () => void this.toggleAutoReview(),
      addSystemMessage: (text) => {
        this.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        this.addStructuredSystemMessage(text, details);
      },
      setStatus: (status) => {
        this.setStatus(status);
      },
      setRequestedModel: (model) => this.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => this.setRequestedReasoningEffort(effort),
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

  private async applyPendingThreadSettings(): Promise<boolean> {
    const client = this.client;
    const threadId = this.state.activeThreadId;
    if (!client || !threadId) return true;

    const update = this.pendingThreadSettingsUpdate();
    if (Object.keys(update).length === 0) return true;

    try {
      await client.updateThreadSettings(threadId, update);
      this.commitPendingThreadSettings(update);
      return true;
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private pendingThreadSettingsUpdate(): Omit<ThreadSettingsUpdateParams, "threadId"> {
    const update: Omit<ThreadSettingsUpdateParams, "threadId"> = {};
    const turnSettings = requestedTurnRuntimeSettings(this.runtimeSnapshot());

    if (this.state.requestedModel.kind !== "default") {
      const model = runtimeOverridePayload(this.state.requestedModel);
      if (model !== undefined) update.model = model;
    }
    if (this.state.requestedReasoningEffort.kind !== "default") {
      const effort = runtimeOverridePayload(this.state.requestedReasoningEffort);
      if (effort !== undefined) update.effort = effort;
    }
    if (this.state.requestedServiceTier !== null) {
      const serviceTier = serviceTierRequestValue(this.state.requestedServiceTier);
      if (serviceTier !== undefined) update.serviceTier = serviceTier;
    }
    if (this.state.requestedApprovalsReviewer !== null) {
      update.approvalsReviewer = this.state.requestedApprovalsReviewer;
    }
    if (this.state.requestedCollaborationMode !== this.state.activeCollaborationMode) {
      if (turnSettings.warning) {
        this.addSystemMessage(`${this.collaborationModeLabel()} mode is selected, but ${turnSettings.warning}`);
      } else if (turnSettings.collaborationMode) {
        update.collaborationMode = turnSettings.collaborationMode;
      }
    }
    return update;
  }

  private commitPendingThreadSettings(update: Omit<ThreadSettingsUpdateParams, "threadId">): void {
    if ("model" in update) {
      this.state.activeModel = update.model ?? null;
      this.state.requestedModel = defaultRuntimeOverride();
    }
    if ("effort" in update) {
      this.state.activeReasoningEffort = update.effort ?? null;
      this.state.requestedReasoningEffort = defaultRuntimeOverride();
    }
    if ("serviceTier" in update) {
      const serviceTier = update.serviceTier;
      this.state.activeServiceTier = this.state.requestedServiceTier ?? reportedServiceTier(serviceTier);
      this.state.requestedServiceTier = null;
    }
    if ("approvalsReviewer" in update) {
      this.state.activeApprovalsReviewer = update.approvalsReviewer ?? null;
      this.state.requestedApprovalsReviewer = null;
    }
    if (update.collaborationMode) {
      this.state.activeCollaborationMode = update.collaborationMode.mode;
    }
  }

  private async toggleFastMode(): Promise<void> {
    const current = currentServiceTier(this.runtimeSnapshot(), readRuntimeConfig(this.state.effectiveConfig));
    const next: ServiceTier = current === "fast" ? "standard" : "fast";
    this.state.requestedServiceTier = next;
    this.state.activeServiceTier = next;
    this.state.runtimePicker = null;
    if (!(await this.applyPendingThreadSettings())) return;
    this.addSystemMessage(next === "fast" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.");
  }

  private async toggleCollaborationMode(): Promise<void> {
    const next = nextCollaborationMode(this.state.requestedCollaborationMode);
    this.state.requestedCollaborationMode = next;
    this.state.runtimePicker = null;
    if (!(await this.applyPendingThreadSettings())) return;
    this.addSystemMessage(collaborationModeToggleMessage(next));
  }

  private async toggleAutoReview(): Promise<void> {
    const next: ApprovalsReviewer = autoReviewActive(this.runtimeSnapshot(), readRuntimeConfig(this.state.effectiveConfig))
      ? "user"
      : "auto_review";
    this.state.requestedApprovalsReviewer = next;
    this.state.activeApprovalsReviewer = next;
    this.state.runtimePicker = null;
    if (!(await this.applyPendingThreadSettings())) return;
    this.addSystemMessage(next === "auto_review" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.");
  }

  private canImplementPlanItem(item: DisplayItem): boolean {
    if (item.kind !== "message" || item.role !== "assistant" || item.proposedPlan !== true) return false;
    if (!this.state.activeThreadId || this.state.busy || this.state.composerDraft.trim().length > 0) return false;
    if (this.state.requestedCollaborationMode !== "plan") return false;
    return latestProposedPlanItem(this.state.displayItems)?.id === item.id;
  }

  private toggleRuntimePicker(picker: NonNullable<ChatState["runtimePicker"]>): void {
    this.state.runtimePicker = this.state.runtimePicker === picker ? null : picker;
    if (this.state.runtimePicker !== null) {
      this.state.openDetails.delete("history");
      this.state.openDetails.delete("status-panel");
    }
    this.render();
  }

  private async setRequestedModelFromUi(model: string | null): Promise<void> {
    await this.setRequestedModel(model);
    this.state.runtimePicker = null;
    this.addSystemMessage(modelOverrideMessage(model));
  }

  private async setRequestedModel(model: string | null): Promise<void> {
    this.state.requestedModel = model === null ? resetRuntimeOverride() : setRuntimeOverride(model);
    await this.applyPendingThreadSettings();
  }

  private async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    await this.setRequestedReasoningEffort(effort);
    this.state.runtimePicker = null;
    this.addSystemMessage(reasoningEffortOverrideMessage(effort));
  }

  private async setRequestedReasoningEffort(effort: ReasoningEffort | null): Promise<void> {
    this.state.requestedReasoningEffort = effort === null ? resetRuntimeOverride() : setRuntimeOverride(effort);
    await this.applyPendingThreadSettings();
  }

  private async resolveApproval(approval: PendingApproval, action: ApprovalAction): Promise<void> {
    this.controller.resolveApproval(approval, action);
    this.plugin.refreshThreadsViewLiveState();
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
    this.plugin.refreshThreadsViewLiveState();
    this.render();
  }

  private async cancelUserInput(input: PendingUserInput): Promise<void> {
    this.controller.cancelUserInput(input);
    this.plugin.refreshThreadsViewLiveState();
    this.render();
  }

  private systemItem(text: string): DisplayItem {
    return createSystemItem(text);
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
    this.state.status = status;
  }

  private restoreThreadPlaceholder(restoredThread: RestoredThreadState): void {
    this.invalidateResumeWork();
    this.restoredThread = restoredThread;
    this.state.activeThreadId = restoredThread.threadId;
    this.state.activeThreadCwd = null;
    this.state.activeTurnId = null;
    this.state.activeModel = null;
    this.state.activeReasoningEffort = null;
    this.state.activeCollaborationMode = "default";
    this.state.activeServiceTier = null;
    this.state.activeApprovalsReviewer = null;
    this.state.activeThreadCreationCliVersion = null;
    this.state.tokenUsage = null;
    this.state.busy = false;
    this.state.displayItems = [this.systemItem("Thread restored. Send a message to resume it.")];
    this.state.pendingTurnStart = null;
    this.state.turnDiffs.clear();
    this.state.approvals = [];
    this.state.pendingUserInputs = [];
    this.state.userInputDrafts.clear();
    this.state.historyCursor = null;
    this.state.loadingHistory = false;
    this.state.messagesPinnedToBottom = true;
    this.setStatus("Thread ready to resume.");
    this.refreshTabHeader();
    this.scheduleDeferredRestoredThreadHydration();
  }

  private beginResumeWork(): number {
    this.resumeGeneration += 1;
    this.history.invalidate();
    return this.resumeGeneration;
  }

  private invalidateResumeWork(): void {
    this.resumeGeneration += 1;
    this.history.invalidate();
  }

  private isStaleResumeWork(generation: number): boolean {
    return generation !== this.resumeGeneration || this.closing;
  }

  private async ensureRestoredThreadLoaded(): Promise<boolean> {
    if (!this.restoredThread) return true;
    this.clearDeferredRestoredThreadHydration();
    if (this.restoredThreadLoading) {
      const threadId = this.restoredThread.threadId;
      await this.restoredThreadLoading;
      return !this.isRestoredThreadPending(threadId);
    }

    const threadId = this.restoredThread.threadId;
    const loading = this.resumeThread(threadId);
    this.restoredThreadLoading = loading;
    try {
      await loading;
    } finally {
      if (this.restoredThreadLoading === loading) {
        this.restoredThreadLoading = null;
      }
    }
    return !this.isRestoredThreadPending(threadId);
  }

  private isRestoredThreadPending(threadId: string): boolean {
    return this.restoredThread?.threadId === threadId;
  }

  private scheduleDeferredRestoredThreadHydration(): void {
    if (!this.opened || !this.restoredThread || this.scheduledRestoredThreadHydrationTimer !== null) return;
    const threadId = this.restoredThread.threadId;
    this.scheduledRestoredThreadHydrationTimer = this.containerEl.win.setTimeout(() => {
      this.scheduledRestoredThreadHydrationTimer = null;
      if (!this.isRestoredThreadPending(threadId)) return;
      void this.ensureRestoredThreadLoaded();
    }, 1_500);
  }

  private clearDeferredRestoredThreadHydration(): void {
    if (this.scheduledRestoredThreadHydrationTimer === null) return;
    this.containerEl.win.clearTimeout(this.scheduledRestoredThreadHydrationTimer);
    this.scheduledRestoredThreadHydrationTimer = null;
  }

  private scheduleDeferredSessionWarmup(): void {
    if (!this.opened || this.connection.isConnected() || this.scheduledSessionWarmupTimer !== null) return;
    this.scheduledSessionWarmupTimer = this.containerEl.win.setTimeout(() => {
      this.scheduledSessionWarmupTimer = null;
      if (!this.opened || this.closing || this.connection.isConnected()) return;
      void this.ensureConnected();
    }, 0);
  }

  private clearDeferredSessionWarmup(): void {
    if (this.scheduledSessionWarmupTimer === null) return;
    this.containerEl.win.clearTimeout(this.scheduledSessionWarmupTimer);
    this.scheduledSessionWarmupTimer = null;
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThreadId;
    if (!threadId) return null;
    const thread = this.state.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
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
    return this.restoredThread?.threadId === threadId ? this.restoredThread.explicitName : null;
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

    this.renderToolbar(this.toolbarEl);

    this.configSlotEl.empty();

    this.renderMessages(this.messagesSlotEl);
    this.renderComposer(this.composerSlotEl);
    this.syncComposerControls();
  }

  private renderToolbar(toolbar: HTMLElement): void {
    const model = this.toolbarViewModel();

    renderToolbar(toolbar, model, {
      toggleHistory: () => {
        this.toggleHistoryPanel();
      },
      toggleAutoReview: () => void this.toggleAutoReview(),
      toggleStatusPanel: () => {
        this.toggleStatusPanel();
      },
      togglePlan: () => void this.toggleCollaborationMode(),
      toggleFast: () => void this.toggleFastMode(),
      toggleRuntime: () => {
        this.toggleRuntimePicker("model");
      },
      connect: () => void this.reconnectFromToolbar(),
      refreshDiagnostics: () => void this.refreshDiagnostics(),
      refreshThreads: () => {
        this.state.openDetails.delete("status-panel");
        void this.refreshThreads();
      },
      resumeThread: (threadId) => {
        if (this.state.busy && threadId !== this.state.activeThreadId) return;
        this.state.openDetails.delete("history");
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
    const snapshot = this.runtimeSnapshot();
    const config = readRuntimeConfig(this.state.effectiveConfig);
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
      autoReviewActive: autoReviewActive(snapshot, config),
      fastActive: currentServiceTier(snapshot, config) === "fast",
      runtimeSummary: runtimeSummaryLabel(model, effort),
      runtimeTitle: `Model: ${model ?? "(Codex default)"}; Effort: ${effort ?? "(Codex default)"}`,
      runtimeEmphasized: false,
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
          archiveConfirm: {
            active: this.archiveConfirmThreadId === threadId,
            defaultSaveMarkdown: this.plugin.settings.archiveExportEnabled,
          },
          rename: this.threadRename.editState(threadId),
        };
      }),
      modelChoices: this.modelToolbarChoices(),
      effortChoices: this.effortToolbarChoices(),
      connectLabel: this.connection.isConnected() ? "Reconnect" : "Connect",
      diagnostics: this.connectionDiagnosticSections(),
      diagnosticAlertLevel: diagnosticAlertLevel(this.state.appServerDiagnostics),
    };
  }

  private async reconnectFromToolbar(): Promise<void> {
    const threadId = this.state.activeThreadId;
    this.state.openDetails.delete("status-panel");
    this.connectionGeneration += 1;
    this.invalidateResumeWork();
    this.connectingPromise = null;
    this.clearDeferredDiagnostics();
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
    if (!threadId) return;
    try {
      await this.resumeThread(threadId);
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private modelToolbarChoices(): ToolbarChoice[] {
    const snapshot = this.runtimeSnapshot();
    const config = readRuntimeConfig(this.state.effectiveConfig);
    const activeModel = currentModel(snapshot, config);
    const models = sortedAvailableModels(this.state.availableModels);
    const choices: ToolbarChoice[] = [
      ...models.slice(0, 12).map((model) => ({
        label: model.model,
        selected: activeModel === model.model,
        onClick: () => void this.setRequestedModelFromUi(model.model),
      })),
    ];
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
    const config = readRuntimeConfig(this.state.effectiveConfig);
    const activeEffort = currentReasoningEffort(snapshot, config);
    return supportedReasoningEfforts(snapshot).map((effort) => ({
      label: effort,
      selected: activeEffort === effort,
      onClick: () => void this.setRequestedReasoningEffortFromUi(effort),
    }));
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

  private async selectThread(threadId: string): Promise<void> {
    if (this.state.busy && threadId !== this.state.activeThreadId) {
      this.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    this.archiveConfirmThreadId = null;
    if (await this.plugin.focusThreadInOpenView(threadId)) return;
    await this.resumeThread(threadId);
  }

  private startArchiveThread(threadId: string): void {
    this.archiveConfirmThreadId = threadId;
    this.scheduleRender();
  }

  private async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
    await this.threadActions.archiveThread(threadId, saveMarkdown);
    this.scheduleRender();
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
          this.scheduleRender();
        }
        return;
      }
    }

    if (this.archiveConfirmThreadId) {
      this.archiveConfirmThreadId = null;
      this.scheduleRender();
    }

    if (this.threadRename.isEditing()) return;

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
    this.archiveConfirmThreadId = null;
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.scheduledRenderTimer !== null) return;
    this.scheduledRenderTimer = this.containerEl.win.setTimeout(() => {
      this.scheduledRenderTimer = null;
      this.render();
    }, 50);
  }

  private scheduleDeferredDiagnostics(): void {
    if (this.scheduledDiagnosticsTimer !== null) return;
    this.scheduledDiagnosticsTimer = this.containerEl.win.setTimeout(() => {
      this.scheduledDiagnosticsTimer = null;
      void this.refreshDeferredDiagnostics();
    }, 1_000);
  }

  private clearDeferredDiagnostics(): void {
    if (this.scheduledDiagnosticsTimer === null) return;
    this.containerEl.win.clearTimeout(this.scheduledDiagnosticsTimer);
    this.scheduledDiagnosticsTimer = null;
  }

  private async refreshDeferredDiagnostics(): Promise<void> {
    if (!this.connection.isConnected()) return;
    await this.session.refreshCapabilityDiagnostics({ cachedSessionMetadata: true });
    this.publishSessionMetadataSnapshot();
    this.render();
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
    const limit = rateLimitSummary(snapshot);
    return [
      "Thread status",
      `Thread: ${this.state.activeThreadId ?? "(none)"}`,
      context ? context.title : "Context: not available",
      ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
    ];
  }

  private modelStatusLines(): string[] {
    const snapshot = this.runtimeSnapshot();
    const config = readRuntimeConfig(this.state.effectiveConfig);
    return [
      `Model: ${currentModel(snapshot, config) ?? "(Codex default)"}`,
      `Override: ${runtimeOverrideLabel(this.state.requestedModel)}`,
      `Provider: ${statusValue(config.modelProvider, "(Codex default)")}`,
      `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
      `Mode: ${this.collaborationModeLabel()}`,
      `Service tier: ${serviceTierLabel(snapshot, config)}`,
    ];
  }

  private effortStatusLines(): string[] {
    const snapshot = this.runtimeSnapshot();
    const config = readRuntimeConfig(this.state.effectiveConfig);
    return [
      `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
      `Override: ${runtimeOverrideLabel(this.state.requestedReasoningEffort)}`,
      `Supported: ${supportedReasoningEfforts(snapshot).join(", ")}`,
    ];
  }

  private connectionDiagnosticSections() {
    return connectionDiagnosticSections({
      connected: this.connection.isConnected(),
      configuredCommand: this.plugin.settings.codexPath,
      initializeResponse: this.state.initializeResponse,
      activeThreadCreationCliVersion: this.state.activeThreadCreationCliVersion,
      diagnostics: this.state.appServerDiagnostics,
    });
  }

  private connectionDiagnosticDetails(): DisplayDetailSection[] {
    return this.connectionDiagnosticSections().map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private async mcpStatusLines(): Promise<string[]> {
    if (!this.client) return ["MCP servers", "Codex app-server is not connected."];

    try {
      const response = await this.client.listMcpServerStatus();
      return mcpStatusLines(response.data, this.state.appServerDiagnostics.mcpServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return ["MCP servers", `Could not load MCP servers: ${message}`];
    }
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.requestedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return {
      effectiveConfig: this.state.effectiveConfig,
      activeThreadId: this.state.activeThreadId,
      activeModel: this.state.activeModel,
      activeReasoningEffort: this.state.activeReasoningEffort,
      activeCollaborationMode: this.state.activeCollaborationMode,
      activeServiceTier: this.state.activeServiceTier,
      activeApprovalsReviewer: this.state.activeApprovalsReviewer,
      requestedModel: this.state.requestedModel,
      requestedReasoningEffort: this.state.requestedReasoningEffort,
      requestedApprovalsReviewer: this.state.requestedApprovalsReviewer,
      requestedCollaborationMode: this.state.requestedCollaborationMode,
      requestedServiceTier: this.state.requestedServiceTier,
      tokenUsage: this.state.tokenUsage,
      rateLimit: this.state.rateLimit,
      hasThreadTurns: this.state.displayItems.some((item) => item.turnId),
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

  private queueMessagesBottomScroll(): void {
    this.state.messagesPinnedToBottom = true;
    this.nextMessageScrollIntent = "force-bottom";
  }

  private preserveMessagesScrollPosition(): void {
    this.nextMessageScrollIntent = "preserve";
  }

  private scrollMessagesToBottomOnFocus(): void {
    this.queueMessagesBottomScroll();
    this.render();
  }

  private clearArchivedActiveThread(threadId: string): boolean {
    if (this.state.activeThreadId !== threadId) return false;
    this.invalidateResumeWork();
    this.restoredThread = null;
    this.clearDeferredRestoredThreadHydration();
    clearActiveThreadState(this.state);
    this.threadRename.resetThreadTurnPresence(false);
    this.notifyActiveThreadIdentityChanged();
    this.plugin.refreshThreadsViewLiveState();
    return true;
  }

  private renderMessages(parent: HTMLElement): void {
    this.messageRenderer.render(parent);
  }

  private pendingRequestsSignature(): string {
    return requestStateSignature(this.state.approvals, this.state.pendingUserInputs, this.state.userInputDrafts);
  }

  private createPendingRequestsElement(): HTMLElement | null {
    if (this.state.approvals.length === 0 && this.state.pendingUserInputs.length === 0) return null;
    const container = createDiv();
    this.renderPendingRequestMessage(container);
    return container.firstElementChild as HTMLElement | null;
  }

  private renderComposer(parent: HTMLElement): void {
    this.composerController.render(parent);
  }

  private syncComposerControls(): void {
    this.composerController.syncControls(this.composerSlotEl);
  }
}

function latestProposedPlanItem(items: DisplayItem[]): DisplayItem | null {
  return [...items].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ?? null;
}

function parseRestoredThreadState(state: unknown): RestoredThreadState | null {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  const threadId = record["threadId"];
  if (typeof threadId !== "string" || threadId.trim().length === 0) return null;
  const title = record["threadTitle"];
  return {
    threadId,
    title: typeof title === "string" && title.trim().length > 0 ? title : null,
    explicitName: null,
  };
}
