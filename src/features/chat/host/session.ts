import type { ModelMetadata } from "../../../domain/catalog/metadata";

import type { Thread } from "../../../domain/threads/model";
import { getThreadTitle } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import { shortThreadId } from "../../../utils";
import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../domain/local-id";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { createChatViewDeferredTasks } from "./lifecycle";
import { ChatConnectionWorkTracker, ChatResumeWorkTracker, type ChatViewDeferredTasks } from "../application/lifecycle";
import { connectionDiagnosticsModel } from "../panel/surface/toolbar-projection";
import { openPanelTurnLifecycle, parseRestoredThreadState } from "../panel/snapshot";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import { runtimeSnapshotForChatState, type RuntimeSnapshot } from "../application/runtime/snapshot";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll-intent";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell";
import { chatTurnBusy, type ChatAction, type ChatState } from "../application/state/root-reducer";
import { createChatStateStore, type ChatStateStore } from "../application/state/store";
import type { ChatSurfaceHandle } from "./surface-handle";
import { createChatPanelRuntime, type ChatPanelEnvironment, type ChatPanelRuntimeParts } from "./runtime";

interface ChatPanelWarmupHost {
  deferredTasks: ChatViewDeferredTasks;
  opened: () => boolean;
  closing: () => boolean;
  connected: () => boolean;
  ensureConnected: () => Promise<void>;
}

function scheduleChatPanelWarmup(host: ChatPanelWarmupHost): void {
  const shouldWarmup = (): boolean => host.opened() && !host.connected();

  if (!shouldWarmup()) return;

  host.deferredTasks.scheduleAppServerWarmup(() => {
    if (!shouldWarmup() || host.closing()) return;
    void host.ensureConnected();
  });
}

function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? getThreadTitle(thread).replace(/\s+/g, " ").trim() : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

export class ChatPanelSession implements ChatSurfaceHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly parts: ChatPanelRuntimeParts;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ChatConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollIntent: ChatMessageScrollIntentState = createChatMessageScrollIntentState();
  private readonly localItemIds: LocalChatItemIdFactory = createLocalChatItemIdFactory();
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.parts = createChatPanelRuntime({
      environment,
      stateStore: this.stateStore,
      deferredTasks: this.deferredTasks,
      connectionWork: this.connectionWork,
      resumeWork: this.resumeWork,
      messageScrollIntent: this.messageScrollIntent,
      state: () => this.state,
      dispatch: (action) => {
        this.dispatch(action);
      },
      systemItem: (text) => this.systemItem(text),
      structuredSystemItem: (text, details) => this.structuredSystemItem(text, details),
      opened: () => this.opened,
      closing: () => this.closing,
      startNewThread: () => this.startNewThread(),
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
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
      notifyActiveThreadIdentityChanged: () => {
        this.notifyActiveThreadIdentityChanged();
      },
      connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
      modelStatusLines: () => this.modelStatusLines(),
      effortStatusLines: () => this.effortStatusLines(),
      statusSummaryLines: () => this.statusSummaryLines(),
      collaborationModeLabel: () => this.collaborationModeLabel(),
    });
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.stateStore.dispatch(action);
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
    this.mountOrRepairShell();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.parts.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
  }

  applyAppServerMetadataSnapshot(metadata: SharedServerMetadata): void {
    this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
  }

  applyAvailableModelsSnapshot(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.state.activeThread.id,
      lastFocused: false,
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

  notifyThreadArchived(threadId: string): void {
    this.parts.thread.identity.notifyThreadArchived(threadId);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.parts.thread.identity.notifyThreadRenamed(threadId, name);
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
    this.applyCachedAppServerState();
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

  private applyCachedAppServerState(): void {
    const threads = this.environment.plugin.threadCatalog.cachedThreads();
    if (threads) this.parts.serverActions.threads.applyThreadList(threads);
    const metadata = this.environment.plugin.threadCatalog.cachedAppServerMetadata();
    if (metadata) this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
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
    scheduleChatPanelWarmup({
      deferredTasks: this.deferredTasks,
      opened: () => this.opened,
      closing: () => this.closing,
      connected: () => this.parts.connection.manager.isConnected(),
      ensureConnected: () => this.parts.connection.controller.ensureConnected(),
    });
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
    this.parts.thread.history.invalidate();
  }

  private async loadSharedThreadList(): Promise<void> {
    const threads = await this.environment.plugin.threadCatalog.refreshThreads(() => this.parts.serverActions.threads.loadThreadList());
    this.parts.serverActions.threads.applyThreadList(threads);
  }

  private notifyActiveThreadIdentityChanged(): void {
    this.refreshTabHeader();
    this.environment.obsidian.requestWorkspaceLayoutSave();
  }

  private refreshTabHeader(): void {
    this.environment.view.refreshTabHeader();
  }

  private refreshLiveState(): void {
    this.environment.plugin.threadCatalog.refreshThreadsViewLiveState();
  }

  private deferLiveStateRefresh(): void {
    this.viewWindow().setTimeout(() => {
      this.refreshLiveState();
    }, 0);
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
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
