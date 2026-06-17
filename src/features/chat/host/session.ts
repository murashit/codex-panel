import type { AppServerClient } from "../../../app-server/connection/client";
import { appServerQueryContextRawEquals, type AppServerQueryContext } from "../../../app-server/query/keys";

import type { Thread } from "../../../domain/threads/model";
import { getThreadTitle } from "../../../domain/threads/model";
import { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { shortThreadId } from "../../../utils";
import { createChatViewDeferredTasks } from "./lifecycle";
import { ChatResumeWorkTracker, type ChatViewDeferredTasks } from "../application/lifecycle";
import { openPanelTurnLifecycle, parseRestoredThreadState, type ChatPanelSnapshot } from "../panel/snapshot";
import type { ChatState } from "../application/state/root-reducer";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell";
import { createChatStateStore, type ChatStateStore } from "../application/state/store";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll";
import type { ChatSurfaceHandle } from "./surface-handle";
import type { ChatPanelEnvironment } from "./runtime";
import { createChatPanelSessionGraph, type ChatPanelSessionGraph } from "./session-graph";

function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? getThreadTitle(thread).replace(/\s+/g, " ").trim() : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

export class ChatPanelSession implements ChatSurfaceHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly graph: ChatPanelSessionGraph;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollIntent: ChatMessageScrollIntentState = createChatMessageScrollIntentState();
  private observedAppServerContext: AppServerQueryContext;
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.graph = this.createSessionGraph();
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
      this.graph.thread.restoration.restore(restoredThread);
      this.scheduleRestoredThreadHydration();
      return;
    }

    this.graph.actions.invalidateResumeWork();
    this.graph.thread.restoration.clear();
    this.graph.thread.restoration.clearHydration();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (!appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.observedAppServerContext = nextContext;
      this.connectionWork.invalidate();
      this.graph.actions.invalidateResumeWork();
      this.graph.connection.manager.resetConnection();
      this.graph.runtime.applyCachedAppServerState();
    }
    this.mountOrRepairShell();
  }

  refreshSharedThreads(): Promise<void> {
    return this.graph.actions.refreshSharedThreads();
  }

  async runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    const client = this.graph.connection.manager.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const result = await operation(client);
    if (this.graph.connection.manager.currentClient() !== client) {
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
      connected: this.graph.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.graph.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.graph.thread.restoration.isPending(threadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  focusComposer(): void {
    this.graph.composer.controller.focus();
  }

  applyThreadArchived(threadId: string): void {
    this.graph.thread.identity.applyThreadArchived(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    this.graph.thread.identity.applyThreadRenamed(threadId, name);
  }

  open(): void {
    this.opened = true;
    this.closing = false;
    this.graph.composer.controller.registerNoteIndexInvalidation((eventRef) => {
      this.environment.obsidian.registerEvent(eventRef);
    });
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.graph.runtime.subscribeAppServerState();
    this.mountOrRepairShell();
    this.scheduleWarmup();
    this.scheduleRestoredThreadHydration();
  }

  close(): void {
    this.opened = false;
    this.closing = true;
    this.connectionWork.invalidate();
    this.graph.actions.invalidateResumeWork();
    this.deferredTasks.clearAll();
    this.graph.runtime.unsubscribeAppServerState();
    const panelRoot = this.environment.view.panelRoot();
    this.graph.actions.dispose();
    unmountChatPanelShell(panelRoot);
    this.graph.connection.manager.disconnect();
    this.graph.runtime.refreshLiveState();
    this.graph.runtime.deferLiveStateRefresh();
  }

  setComposerText(text: string): void {
    this.graph.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.graph.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    await this.graph.actions.startNewThread();
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private mountOrRepairShell(): void {
    const root = this.environment.view.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: this.stateStore,
      showToolbar: this.environment.plugin.settingsRef.settings.showToolbar,
      parts: {
        toolbar: {
          surface: this.graph.surface.toolbar,
          actions: this.graph.toolbar.actions,
        },
        goal: this.graph.surface.goal,
        messageStream: this.graph.render.messageStreamPresenter,
        composer: {
          controller: this.graph.composer.controller,
          actions: {
            submit: () => void this.graph.composer.submission.submit(),
          },
        },
      },
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.graph.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.graph.connection.controller.ensureConnected();
    });
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
    this.graph.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.environment.view.viewWindow() as (Window & { Element: typeof Element }) | null,
      contains: (element) => this.environment.view.containsElement(element),
      renameEditing: this.graph.thread.rename.isEditing(),
    });
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
  }

  private restoredThreadTitle(): string | null {
    return this.graph.thread.restoration.title();
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.graph.thread.restoration.ensureLoaded((threadId) => this.graph.thread.resume.resumeThread(threadId));
  }

  private scheduleRestoredThreadHydration(): void {
    this.graph.thread.restoration.scheduleHydration((threadId) => this.graph.thread.resume.resumeThread(threadId));
  }

  private createSessionGraph(): ChatPanelSessionGraph {
    return createChatPanelSessionGraph({
      environment: this.environment,
      stateStore: this.stateStore,
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      connectionWork: this.connectionWork,
      messageScrollIntent: this.messageScrollIntent,
      getOpened: () => this.opened,
      getClosing: () => this.closing,
      viewWindow: () => this.viewWindow(),
    });
  }
}
