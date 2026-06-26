import type { AppServerClient } from "../../../app-server/connection/client";
import { type AppServerQueryContext, appServerQueryContextMatches, appServerQueryContextRawEquals } from "../../../app-server/query/keys";
import { pendingRequestCountsFromQueues } from "../../../domain/pending-requests/aggregate";
import { threadMeaningfulTitle, threadWindowTitle } from "../../../domain/threads/title";
import { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { ChatResumeWorkTracker, type ChatViewDeferredTasks, type RestoredThreadPlaceholderState } from "../application/lifecycle";
import type { ChatState } from "../application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../application/state/store";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell.dom";
import { type ChatPanelSnapshot, openPanelTurnLifecycle, parseRestoredThreadState } from "../panel/snapshot";
import { type ChatMessageScrollController, createChatMessageScrollController } from "../panel/surface/message-stream-scroll";
import { createChatViewDeferredTasks } from "./deferred-tasks";
import type { ChatPanelEnvironment } from "./environment";
import { type ChatPanelSessionGraph, createChatPanelSessionGraph } from "./session-graph";
import type { ChatSurfaceHandle } from "./surface-handle";

export class ChatPanelSession implements ChatSurfaceHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly graph: ChatPanelSessionGraph;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollController: ChatMessageScrollController = createChatMessageScrollController();
  private observedAppServerContext: AppServerQueryContext;
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.graph = this.createSessionGraph();
  }

  displayTitle(): string {
    return threadWindowTitle(this.panelThreadId(), this.state.threadList.listedThreads, this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    const threadId = this.panelThreadId();
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
      return;
    }

    this.graph.actions.invalidateThreadWork();
    this.graph.thread.restoration.clear();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (!appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.observedAppServerContext = nextContext;
      this.connectionWork.invalidate();
      this.graph.actions.invalidateThreadWork();
      this.graph.connection.manager.resetConnection();
      this.graph.runtime.sharedState.applyCached();
    }
    this.mountOrRepairShell();
  }

  refreshSharedThreads(): Promise<void> {
    return this.graph.actions.refreshSharedThreads();
  }

  canServeAppServerContext(context: AppServerQueryContext): boolean {
    const connectionContext = this.graph.connection.manager.currentConnectionContext();
    return Boolean(
      connectionContext &&
        appServerQueryContextMatches(
          {
            codexPath: connectionContext.codexPath,
            vaultPath: connectionContext.cwd,
          },
          context,
        ),
    );
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
    const pendingRequests = pendingRequestCountsFromQueues(this.state.requests);
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.panelThreadId(),
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingApprovals: pendingRequests.approvals,
      pendingUserInputs: pendingRequests.userInputs,
      pendingMcpElicitations: pendingRequests.mcpElicitations,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.graph.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.graph.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    const restoredThreadId = this.restoredThread()?.threadId ?? null;
    if ((threadId && this.graph.thread.restoration.isPending(threadId)) || (!threadId && restoredThreadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  async hydrateRestoredThread(): Promise<void> {
    await this.ensureRestoredThreadLoaded();
  }

  focusComposer(): void {
    this.graph.composer.controller.focus();
  }

  applyThreadArchived(threadId: string): void {
    this.graph.thread.identity.applyThreadArchiveToActiveIdentity(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    this.graph.thread.identity.applyThreadRenameToActiveIdentity(threadId, name);
  }

  open(): void {
    this.opened = true;
    this.closing = false;
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.graph.runtime.sharedState.subscribe();
    this.mountOrRepairShell();
    this.scheduleWarmup();
  }

  close(): void {
    this.opened = false;
    this.closing = true;
    this.connectionWork.invalidate();
    this.graph.actions.invalidateThreadWork();
    this.deferredTasks.clearAll();
    this.graph.runtime.sharedState.unsubscribe();
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
          renderer: this.graph.composer.controller,
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
    return thread ? threadMeaningfulTitle(thread) : null;
  }

  private restoredThreadTitle(): string | null {
    return this.restoredThread()?.title ?? null;
  }

  private restoredThread(): RestoredThreadPlaceholderState | null {
    return this.graph.thread.restoration.placeholder();
  }

  private panelThreadId(): string | null {
    return this.restoredThread()?.threadId ?? this.state.activeThread.id;
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.graph.thread.restoration.ensureLoaded((threadId) => this.graph.thread.resume.resumeThread(threadId));
  }

  private createSessionGraph(): ChatPanelSessionGraph {
    return createChatPanelSessionGraph({
      environment: this.environment,
      stateStore: this.stateStore,
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      connectionWork: this.connectionWork,
      messageScrollController: this.messageScrollController,
      getClosing: () => this.closing,
      viewWindow: () => this.viewWindow(),
    });
  }
}
