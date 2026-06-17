import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerObservedQueryResult } from "../../../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import { appServerQueryContextRawEquals, type AppServerQueryContext } from "../../../app-server/query/keys";
import type { ModelMetadata } from "../../../domain/catalog/metadata";

import type { Thread } from "../../../domain/threads/model";
import { getThreadTitle } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { shortThreadId } from "../../../utils";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../domain/local-id";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { createChatViewDeferredTasks } from "./lifecycle";
import { ChatResumeWorkTracker, type ChatViewDeferredTasks } from "../application/lifecycle";
import { connectionDiagnosticsModel } from "../application/connection/diagnostics-display";
import { openPanelTurnLifecycle, parseRestoredThreadState, type ChatPanelSnapshot } from "../panel/snapshot";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import { runtimeSnapshotForChatState, type RuntimeSnapshot } from "../application/runtime/snapshot";
import { chatTurnBusy, type ChatAction, type ChatState } from "../application/state/root-reducer";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell";
import { createChatStateStore, type ChatStateStore } from "../application/state/store";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll";
import type { ChatSurfaceHandle } from "./surface-handle";
import type { ChatPanelEnvironment } from "./runtime";
import { createChatPanelSessionParts, type ChatPanelSessionParts, type ChatPanelSessionStatus } from "./session-parts";

function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? getThreadTitle(thread).replace(/\s+/g, " ").trim() : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

export class ChatPanelSession implements ChatSurfaceHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly parts: ChatPanelSessionParts;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollIntent: ChatMessageScrollIntentState = createChatMessageScrollIntentState();
  private readonly localItemIds: LocalChatItemIdFactory = createLocalChatItemIdFactory();
  private readonly appServerStateUnsubscribers: (() => void)[] = [];
  private observedAppServerContext: AppServerQueryContext;
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.parts = this.createSessionParts();
  }

  displayTitle(): string {
    return codexPanelDisplayTitle(this.state.activeThread.id, this.state.threadList.listedThreads, this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    const threadId = this.state.activeThread.id;
    if (!threadId) return { version: 1 };

    const threadTitle = this.restoredThreadTitle() ?? this.activeThreadTitle();
    return {
      version: 1,
      threadId,
      ...(threadTitle ? { threadTitle } : {}),
    };
  }

  applyViewState(state: unknown): void {
    const restoredThread = parseRestoredThreadState(state);
    if (restoredThread) {
      this.parts.thread.restoration.restore(restoredThread);
      this.scheduleRestoredThreadHydration();
      return;
    }

    this.invalidateResumeWork();
    this.parts.thread.restoration.clear();
    this.parts.thread.restoration.clearHydration();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (!appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.observedAppServerContext = nextContext;
      this.connectionWork.invalidate();
      this.invalidateResumeWork();
      this.parts.connection.manager.resetConnection();
      this.applyCachedAppServerState();
    }
    this.mountOrRepairShell();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  async runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    const client = this.parts.connection.manager.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const result = await operation(client);
    if (this.parts.connection.manager.currentClient() !== client) {
      throw new Error("Codex app-server connection changed while loading shared data.");
    }
    return result;
  }

  openPanelSnapshot(): ChatPanelSnapshot {
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.state.activeThread.id,
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingApprovals: this.state.requests.approvals.length,
      pendingUserInputs: this.state.requests.pendingUserInputs.length,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.parts.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.parts.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.parts.thread.restoration.isPending(threadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  focusComposer(): void {
    this.parts.composer.controller.focus();
  }

  applyThreadArchived(threadId: string): void {
    this.parts.thread.identity.applyThreadArchived(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    this.parts.thread.identity.applyThreadRenamed(threadId, name);
  }

  open(): void {
    this.opened = true;
    this.closing = false;
    this.parts.composer.controller.registerNoteIndexInvalidation((eventRef) => {
      this.environment.obsidian.registerEvent(eventRef);
    });
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.subscribeAppServerState();
    this.mountOrRepairShell();
    this.scheduleWarmup();
    this.scheduleRestoredThreadHydration();
  }

  close(): void {
    this.opened = false;
    this.closing = true;
    this.connectionWork.invalidate();
    this.invalidateResumeWork();
    this.deferredTasks.clearAll();
    this.unsubscribeAppServerState();
    const panelRoot = this.environment.view.panelRoot();
    this.parts.render.messageStreamPresenter.dispose();
    this.parts.composer.controller.dispose();
    unmountChatPanelShell(panelRoot);
    this.parts.connection.manager.disconnect();
    this.refreshLiveState();
    this.deferLiveStateRefresh();
  }

  setComposerText(text: string): void {
    this.parts.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.parts.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    if (chatTurnBusy(this.state)) return;

    this.parts.thread.identity.clearActiveThreadContext();
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "connection/status-set", statusText: "New chat." });
    this.focusComposer();
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.stateStore.dispatch(action);
  }

  private receiveObservedThreads(threads: readonly Thread[]): void {
    this.parts.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
  }

  private receiveObservedThreadResult(result: AppServerObservedQueryResult<readonly Thread[]>): void {
    if (result.data) this.receiveObservedThreads(result.data);
  }

  private receiveObservedAppServerMetadata(metadata: SharedServerMetadata): void {
    this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
  }

  private receiveObservedAppServerMetadataResult(result: AppServerObservedQueryResult<SharedServerMetadata>): void {
    if (result.data) this.receiveObservedAppServerMetadata(result.data);
  }

  private receiveObservedModels(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
  }

  private receiveObservedModelsResult(result: AppServerObservedQueryResult<readonly ModelMetadata[]>): void {
    if (result.data) this.receiveObservedModels(result.data);
  }

  private applyCachedAppServerState(): void {
    const threads = this.environment.plugin.threadCatalog.snapshot();
    if (threads) this.parts.serverActions.threads.applyThreadList(threads);
    const metadata = this.environment.plugin.appServerData.appServerMetadataSnapshot();
    if (metadata) this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
    const models = this.environment.plugin.appServerData.modelsSnapshot();
    if (models) this.receiveObservedModels(models);
  }

  private subscribeAppServerState(): void {
    this.unsubscribeAppServerState();
    this.applyCachedAppServerState();
    this.appServerStateUnsubscribers.push(
      this.environment.plugin.threadCatalog.observe(
        (result) => {
          this.receiveObservedThreadResult(result);
        },
        { emitCurrent: false },
      ),
      this.environment.plugin.appServerData.observeAppServerMetadataResult(
        (result) => {
          this.receiveObservedAppServerMetadataResult(result);
        },
        { emitCurrent: false },
      ),
      this.environment.plugin.appServerData.observeModelsResult(
        (result) => {
          this.receiveObservedModelsResult(result);
        },
        { emitCurrent: false },
      ),
    );
  }

  private unsubscribeAppServerState(): void {
    while (this.appServerStateUnsubscribers.length > 0) {
      this.appServerStateUnsubscribers.pop()?.();
    }
  }

  private mountOrRepairShell(): void {
    const root = this.environment.view.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: this.stateStore,
      showToolbar: this.environment.plugin.settingsRef.settings.showToolbar,
      parts: {
        toolbar: {
          surface: this.parts.surface.toolbar,
          actions: this.parts.toolbar.actions,
        },
        goal: this.parts.surface.goal,
        messageStream: this.parts.render.messageStreamPresenter,
        composer: {
          controller: this.parts.composer.controller,
          actions: {
            submit: () => void this.parts.composer.submission.submit(),
          },
        },
      },
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.parts.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.parts.connection.controller.ensureConnected();
    });
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
    this.parts.thread.history.invalidate();
  }

  private async loadSharedThreadList(): Promise<void> {
    try {
      const threads = await this.environment.plugin.threadCatalog.refresh();
      this.parts.serverActions.threads.applyThreadList(threads);
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      throw error;
    }
  }

  private notifyActiveThreadIdentityChanged(): void {
    this.refreshTabHeader();
    this.environment.obsidian.requestWorkspaceLayoutSave();
  }

  private refreshTabHeader(): void {
    this.environment.view.refreshTabHeader();
  }

  private refreshLiveState(): void {
    this.environment.plugin.workspace.refreshThreadsViewLiveState();
  }

  private deferLiveStateRefresh(): void {
    this.viewWindow().setTimeout(() => {
      this.refreshLiveState();
    }, 0);
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
  }

  private currentAppServerContext(): AppServerQueryContext {
    return {
      codexPath: this.environment.plugin.settingsRef.settings.codexPath,
      vaultPath: this.environment.plugin.settingsRef.vaultPath,
    };
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.parts.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.environment.view.viewWindow() as (Window & { Element: typeof Element }) | null,
      contains: (element) => this.environment.view.containsElement(element),
      renameEditing: this.parts.thread.rename.isEditing(),
    });
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
  }

  private restoredThreadTitle(): string | null {
    return this.parts.thread.restoration.title();
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.parts.thread.restoration.ensureLoaded((threadId) => this.parts.thread.resume.resumeThread(threadId));
  }

  private scheduleRestoredThreadHydration(): void {
    this.parts.thread.restoration.scheduleHydration((threadId) => this.parts.thread.resume.resumeThread(threadId));
  }

  private createSessionParts(): ChatPanelSessionParts {
    return createChatPanelSessionParts(this.sessionPartsHost(), this.createSessionStatus());
  }

  private sessionPartsHost(): Parameters<typeof createChatPanelSessionParts>[0] {
    return {
      environment: this.environment,
      stateStore: this.stateStore,
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      connectionWork: this.connectionWork,
      messageScrollIntent: this.messageScrollIntent,
      getOpened: () => this.opened,
      getClosing: () => this.closing,
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      loadSharedThreadList: () => this.loadSharedThreadList(),
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      refreshLiveState: () => {
        this.refreshLiveState();
      },
      deferLiveStateRefresh: () => {
        this.deferLiveStateRefresh();
      },
      startNewThread: () => this.startNewThread(),
      statusSummaryLines: () => this.statusSummaryLines(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
      connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
    };
  }

  private createSessionStatus(): ChatPanelSessionStatus {
    return {
      set: (statusText, phase) => {
        this.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
      },
      addSystemMessage: (text) => {
        this.dispatch({ type: "message-stream/system-item-added", item: this.systemItem(text) });
      },
      addStructuredSystemMessage: (text, details) => {
        this.dispatch({ type: "message-stream/system-item-added", item: this.structuredSystemItem(text, details) });
      },
    };
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

  private connectionDiagnosticDetails(): MessageStreamNoticeSection[] {
    return connectionDiagnosticsModel({
      state: this.state,
      connected: this.parts.connection.manager.isConnected(),
      configuredCommand: this.environment.plugin.settingsRef.settings.codexPath,
    }).map((section) => ({
      title: section.title,
      auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.runtime.selectedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return runtimeSnapshotForChatState(this.state);
  }

  private systemItem(text: string): MessageStreamItem {
    return createSystemItem(this.localItemIds.next("system"), text);
  }

  private structuredSystemItem(text: string, details: MessageStreamNoticeSection[]): MessageStreamItem {
    return createStructuredSystemItem(this.localItemIds.next("system"), text, details);
  }
}
