import type { AppServerClient } from "../../../app-server/connection/client";
import { type AppServerQueryContext, appServerQueryContextMatches, appServerQueryContextRawEquals } from "../../../app-server/query/keys";
import { pendingRequestCountsFromQueues } from "../../../domain/pending-requests/aggregate";
import { threadMeaningfulTitle, threadWindowTitle } from "../../../domain/threads/title";
import type { ChatState } from "../application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../application/state/store";
import { parseRestoredThreadState, type RestoredThreadPlaceholderState } from "../application/threads/restored-thread-lifecycle";
import { ChatResumeWorkTracker } from "../application/threads/resume-work";
import { renderChatPanelShell, unmountChatPanelShell } from "../panel/shell.dom";
import { type ChatThreadStreamScrollBinding, createChatThreadStreamScrollBinding } from "../panel/thread-stream-scroll-binding";
import type { ChatPanelEnvironment, ChatPanelHandle, ChatWorkspacePanelSnapshot, ChatWorkspacePanelTurnLifecycle } from "./contracts";
import { type ChatViewDeferredTasks, createChatViewDeferredTasks } from "./session/deferred-work";
import { type ChatPanelSessionGraph, createChatPanelSessionGraph } from "./session-graph";

export class ChatPanelSession implements ChatPanelHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly graph: ChatPanelSessionGraph;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly threadStreamScrollBinding: ChatThreadStreamScrollBinding = createChatThreadStreamScrollBinding();
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
      void this.graph.actions.reconnect();
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
      throw new Error("Codex app-server connection changed while loading shared queries.");
    }
    return result;
  }

  openPanelSnapshot(): ChatWorkspacePanelSnapshot {
    const pendingRequests = pendingRequestCountsFromQueues(this.state.requests);
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.panelThreadId(),
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingRequests,
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
    this.graph.composer.controller.focusComposer();
  }

  applyThreadArchived(threadId: string): void {
    this.graph.thread.identity.applyThreadArchiveToActiveIdentity(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    const previousRestoredExplicitName = this.restoredThread()?.explicitName ?? null;
    this.graph.thread.identity.applyThreadRenameToActiveIdentity(threadId, name);
    if (this.restoredThread()?.explicitName !== previousRestoredExplicitName) {
      this.mountOrRepairShell();
    }
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
    this.graph.connection.actions.invalidate();
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
    await this.graph.connection.actions.ensureConnected();
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
      showToolbar: this.environment.plugin.settingsRef.settings.showToolbar(),
      parts: this.graph.shell.parts,
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.graph.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.graph.connection.actions.ensureConnected();
    });
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
  }

  private currentAppServerContext(): AppServerQueryContext {
    return {
      codexPath: this.environment.plugin.settingsRef.settings.codexPath(),
      vaultPath: this.environment.plugin.settingsRef.vaultPath,
    };
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.graph.shell.closeToolbarPanelOnOutsidePointer(event);
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
      threadStreamScrollBinding: this.threadStreamScrollBinding,
      getClosing: () => this.closing,
      viewWindow: () => this.viewWindow(),
    });
  }
}

function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): ChatWorkspacePanelTurnLifecycle {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}
