import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../app-server/client";
import { ConnectionManager, StaleConnectionError } from "../app-server/connection-manager";
import type { ServiceTier } from "../app-server/service-tier";
import type { ApprovalAction, PendingApproval } from "../approvals/model";
import type { SlashCommandName } from "../composer/slash-commands";
import { parseSlashCommand } from "../composer/suggestions";
import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import { createSystemItem } from "../display/system";
import type { DisplayItem } from "../display/types";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Thread } from "../generated/app-server/v2/Thread";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import {
  collaborationModeLabel as formatCollaborationModeLabel,
  collaborationModeToggleMessage,
  nextCollaborationMode,
} from "../runtime/collaboration-mode";
import { PanelController } from "./controller";
import { connectionDiagnosticLines, connectionDiagnosticRows, diagnosticAlertLevel } from "./diagnostics";
import { rollbackCandidateFromItems } from "./rollback";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../runtime/view";
import {
  commitRuntimeOverride,
  configRecord,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  requestedOrConfiguredServiceTier,
  requestedTurnRuntimeSettings,
  resetRuntimeOverride,
  runtimeOverrideLabel,
  runtimeSummaryLabel,
  serviceTierLabel,
  setRuntimeOverride,
  supportedReasoningEfforts,
  type RuntimeSnapshot,
} from "../runtime/state";
import { sortedAvailableModels } from "../runtime/model";
import { compactContextLabel, modelOverrideMessage, reasoningEffortOverrideMessage } from "../runtime/settings";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult } from "./slash-commands";
import type { ThreadReferenceInput } from "./slash-commands";
import { PanelSessionController } from "./session-controller";
import { statusValue, usageLimitStatusLines } from "./status-lines";
import { ThreadHistoryLoader } from "./thread-history";
import { ThreadRenameController } from "./thread-rename";
import { pendingRequestsSignature as requestStateSignature, userInputDraftKey, userInputOtherDraftKey } from "./request-state";
import type { CodexPanelSettings } from "../settings/model";
import { questionDefaultAnswer, type PendingUserInput } from "../user-input/model";
import { PanelComposerController } from "./composer-controller";
import { clearActiveThreadState, clearConnectionScopedState, createPanelState, type PanelState } from "./state";
import { codexPanelDisplayTitle, getThreadTitle, inheritedForkThreadName, upsertThread } from "../threads/model";
import {
  referencedThreadDisplay,
  referencedThreadPrompt,
  referencedThreadStatus,
  referencedThreadTurns,
  REFERENCED_THREAD_TURN_LIMIT,
  type ReferencedThreadDisplay,
} from "../threads/reference";
import { renderPendingRequestMessage } from "../ui/pending-request-message";
import { renderToolbar, toolbarSignature, type ToolbarChoice, type ToolbarViewModel } from "../ui/toolbar";
import type { TurnDiffViewState } from "../ui/turn-diff";
import { PanelMessageRenderer } from "./message-renderer";

export interface CodexPanelHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openThreadInNewView(threadId: string): Promise<unknown>;
  openTurnDiff(state: TurnDiffViewState): Promise<void>;
  refreshOpenThreadLists(): void;
}

export class CodexPanelView extends ItemView {
  private client: AppServerClient | null = null;
  private readonly connection: ConnectionManager;
  private readonly controller: PanelController;
  private readonly session: PanelSessionController;
  private readonly history: ThreadHistoryLoader;
  private readonly threadRename: ThreadRenameController;
  private readonly state: PanelState = createPanelState();
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly composerController: PanelComposerController;
  private readonly messageRenderer: PanelMessageRenderer;
  private readonly blockSignatures = new Map<string, string>();
  private toolbarEl: HTMLElement | null = null;
  private configSlotEl: HTMLElement | null = null;
  private messagesSlotEl: HTMLElement | null = null;
  private composerSlotEl: HTMLElement | null = null;
  private scheduledRenderTimer: number | null = null;
  private toolbarSignature: string | null = null;
  private forceScrollMessagesToBottomOnNextRender = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexPanelHost,
  ) {
    super(leaf);
    this.messageRenderer = new PanelMessageRenderer({
      app: this.app,
      owner: this,
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      blockSignatures: this.blockSignatures,
      consumeForceScrollToBottom: () => {
        const value = this.forceScrollMessagesToBottomOnNextRender;
        this.forceScrollMessagesToBottomOnNextRender = false;
        return value;
      },
      loadOlderTurns: () => void this.history.loadOlder(),
      rollbackThread: (threadId) => void this.rollbackThread(threadId),
      implementPlan: (item) => void this.implementPlan(item),
      openTurnDiff: (state) => void this.plugin.openTurnDiff(state),
      pendingRequestsSignature: () => this.pendingRequestsSignature(),
      renderPendingRequests: () => this.createPendingRequestsElement(),
    });
    this.composerController = new PanelComposerController({
      app: this.app,
      state: this.state,
      viewId: this.viewId,
      sendShortcut: () => this.plugin.settings.sendShortcut,
      canInterrupt: () => this.state.busy && Boolean(this.state.activeThreadId && this.state.activeTurnId),
      currentModelForSuggestions: () => currentModel(this.runtimeSnapshot()),
      renderIfDetached: () => this.render(),
      onSubmit: () => void this.submitComposerAction(),
      onNewThread: () => void this.startNewThread(),
    });
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
      refreshSkills: (forceReload) => void this.refreshSkills(forceReload),
      maybeNameThread: (threadId, turn) => this.threadRename.maybeAutoNameThread(threadId, turn),
      recordMcpStartupStatus: (name, status, message) => {
        this.session.recordMcpStartupStatus(name, status, message);
        this.scheduleRender();
      },
      respondToServerRequest: (requestId, result) => this.respondToServerRequest(requestId, result),
      rejectServerRequest: (requestId, code, message) => this.rejectServerRequest(requestId, code, message),
    });
    this.session = new PanelSessionController({
      state: this.state,
      vaultPath: this.plugin.vaultPath,
      currentClient: () => this.connection.currentClient(),
      runtimeSnapshot: () => this.runtimeSnapshot(),
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
    return codexPanelDisplayTitle(this.state.activeThreadId, this.state.listedThreads);
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

  async openThread(threadId: string): Promise<void> {
    await this.resumeThread(threadId);
  }

  async onOpen(): Promise<void> {
    this.composerController.registerNoteIndexInvalidation((eventRef) => this.registerEvent(eventRef));
    this.registerDomEvent(this.containerEl.doc, "pointerdown", (event) => this.closeToolbarPanelOnOutsidePointer(event));
    this.render();
    await this.ensureConnected();
  }

  async onClose(): Promise<void> {
    if (this.scheduledRenderTimer !== null) {
      this.containerEl.win.clearTimeout(this.scheduledRenderTimer);
      this.scheduledRenderTimer = null;
    }
    this.connection.disconnect();
    this.client = null;
  }

  setComposerText(text: string): void {
    this.composerController.setDraft(text, { focus: true, renderIfDetached: true });
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
      await this.session.refreshCapabilityDiagnostics();
      await this.session.refreshThreadList();
      this.refreshTabHeader();
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
      this.state.turnDiffs.clear();
      this.state.displayItems = [this.systemItem(`Started thread ${response.thread.id}`)];
      this.forceMessagesToBottom();
      await this.refreshThreads();
      this.refreshTabHeader();
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
      this.refreshTabHeader();
      this.render();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    const alreadyConnected = this.connection.isConnected();
    await this.ensureConnected();
    if (!this.client) return;
    if (alreadyConnected) await this.session.refreshCapabilityDiagnostics();
    this.render();
  }

  private async refreshSkills(forceReload = false): Promise<void> {
    this.client = this.connection.currentClient();
    if (!this.client) return;
    await this.session.refreshSkills(forceReload);
    this.render();
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
      this.state.turnDiffs.clear();
      this.state.historyCursor = null;
      this.state.listedThreads = upsertThread(this.state.listedThreads, response.thread);
      this.threadRename.resetThreadTurnPresence(false);
      this.refreshTabHeader();
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
      this.render();
      return;
    }

    await this.sendTurnText(text);
  }

  private async sendTurnText(text: string, codexInputOverride?: UserInput[], referencedThread?: ReferencedThreadDisplay): Promise<void> {
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
        this.refreshTabHeader();
        this.threadRename.resetThreadTurnPresence(false);
      }

      optimisticUserId = `local-user-${Date.now()}`;
      this.state.displayItems.push({
        id: optimisticUserId,
        kind: "message",
        role: "user",
        text,
        copyText: text,
        ...(referencedThread ? { referencedThread } : {}),
        markdown: true,
      });
      this.forceMessagesToBottom();
      this.composerController.setDraft("");
      this.state.busy = true;
      this.render();

      const turnSettings = requestedTurnRuntimeSettings(this.runtimeSnapshot());
      if (turnSettings.warning) {
        this.addSystemMessage(`${this.collaborationModeLabel()} mode is selected, but ${turnSettings.warning}`);
      }
      const codexInput = codexInputOverride ?? this.composerController.codexInput(text);
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

    this.composerController.setDraft("", { clearSuggestions: true });
    this.syncComposerControls();

    try {
      await this.client.steerTurn(threadId, expectedTurnId, codexInputOverride ?? this.composerController.codexInput(text));
      this.state.displayItems.push({
        id: `local-steer-${Date.now()}`,
        kind: "message",
        role: "user",
        text,
        copyText: text,
        turnId: expectedTurnId,
        ...(referencedThread ? { referencedThread } : {}),
        markdown: true,
      });
      this.forceMessagesToBottom();
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

  private async executeSlashCommand(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | void> {
    if (!this.client) return;
    return runSlashCommand(command, args, {
      activeThreadId: this.state.activeThreadId,
      listedThreads: this.state.listedThreads,
      startNewThread: () => this.startNewThread(),
      resumeThread: (threadId) => this.resumeThread(threadId),
      referThread: (thread, message) => this.referencedThreadInput(thread, message),
      forkThread: (threadId) => this.forkThread(threadId),
      rollbackThread: (threadId) => this.rollbackThread(threadId),
      compactThread: async (threadId) => {
        await this.client?.compactThread(threadId);
      },
      busy: this.state.busy,
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

  private canImplementPlanItem(item: DisplayItem): boolean {
    if (item.kind !== "message" || item.role !== "assistant" || item.proposedPlan !== true) return false;
    if (!this.state.activeThreadId || this.state.busy || this.state.composerDraft.trim().length > 0) return false;
    if (this.state.requestedCollaborationMode !== "plan") return false;
    return latestProposedPlanItem(this.state.displayItems)?.id === item.id;
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
      refreshDiagnostics: () => void this.refreshDiagnostics(),
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
      diagnosticAlertLevel: diagnosticAlertLevel(this.state.appServerDiagnostics),
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
    const viewWindow = this.containerEl.doc.defaultView;
    if (viewWindow && target instanceof viewWindow.Element) {
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
    this.scheduledRenderTimer = this.containerEl.win.setTimeout(() => {
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
    const limit = rateLimitSummary(snapshot);
    return [
      "Session status",
      `Session: ${this.state.activeThreadId ?? "(none)"}`,
      context ? context.title : "Context: not available",
      ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
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
      diagnostics: this.state.appServerDiagnostics,
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
      const sourceName = inheritedForkThreadName(threadId, this.state.listedThreads);
      const response = await this.client.forkThread(threadId, this.plugin.vaultPath);
      const forkedThreadId = response.thread.id;
      if (sourceName) {
        try {
          await this.client.setThreadName(forkedThreadId, sourceName);
          this.plugin.refreshOpenThreadLists();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
        }
      }
      try {
        await this.plugin.openThreadInNewView(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
      }
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async rollbackThread(threadId: string): Promise<void> {
    if (this.state.busy) {
      this.addSystemMessage("Interrupt the current turn before rolling back.");
      return;
    }
    await this.ensureConnected();
    if (!this.client) return;

    const candidate = rollbackCandidateFromItems(this.state.displayItems);
    if (!candidate) {
      this.addSystemMessage("No completed turn to roll back.");
      return;
    }

    try {
      this.setStatus("Rolling back latest turn...");
      const response = await this.client.rollbackThread(threadId);
      this.state.activeThreadId = response.thread.id;
      this.state.activeThreadCwd = response.thread.cwd ?? this.state.activeThreadCwd;
      this.state.activeTurnId = null;
      this.state.tokenUsage = null;
      this.state.historyCursor = null;
      this.state.turnDiffs.clear();
      this.state.listedThreads = upsertThread(this.state.listedThreads, response.thread);
      await this.history.loadLatest(response.thread.id);
      this.setComposerText(candidate.text);
      this.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
      this.setStatus("Rolled back latest turn.");
      this.refreshTabHeader();
      await this.refreshThreads();
    } catch (error) {
      this.addSystemMessage(error instanceof Error ? error.message : String(error));
      this.setStatus("Rollback failed.");
    }
  }

  private forceMessagesToBottom(): void {
    this.state.messagesPinnedToBottom = true;
    this.forceScrollMessagesToBottomOnNextRender = true;
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
