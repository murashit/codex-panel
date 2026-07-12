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
import { ChatPanelSessionRuntime } from "./session-runtime";

export class ChatPanelSession implements ChatPanelHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly runtime: ChatPanelSessionRuntime;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly threadStreamScrollBinding: ChatThreadStreamScrollBinding = createChatThreadStreamScrollBinding();
  private observedAppServerContext: AppServerQueryContext;
  private ephemeralSourcePlaceholder: { threadId: string; title: string | null } | null = null;
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.runtime = this.createSessionRuntime();
  }

  displayTitle(): string {
    if (this.state.activeThread.lifetime?.kind === "ephemeral" || (!this.state.activeThread.id && this.ephemeralSourcePlaceholder)) {
      return "Side chat";
    }
    return threadWindowTitle(this.panelThreadId(), this.state.threadList.listedThreads, this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    const lifetime = this.state.activeThread.lifetime;
    if (lifetime?.kind === "ephemeral") {
      return {
        version: 2,
        ephemeralSource: { threadId: lifetime.sourceThreadId, title: lifetime.sourceThreadTitle },
      };
    }
    if (!this.state.activeThread.id && this.ephemeralSourcePlaceholder) {
      return { version: 2, ephemeralSource: { ...this.ephemeralSourcePlaceholder } };
    }
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
    const ephemeralSource = parseEphemeralSourceState(state);
    if (ephemeralSource) {
      this.ephemeralSourcePlaceholder = ephemeralSource;
      this.runtime.actions.invalidateThreadWork();
      this.runtime.thread.restoration.clear();
      this.stateStore.dispatch({
        type: "thread-stream/system-item-added",
        item: {
          id: "restored-side-chat-unavailable",
          kind: "system",
          role: "system",
          text: "This side conversation is no longer available.",
        },
      });
      return;
    }
    this.ephemeralSourcePlaceholder = null;
    const restoredThread = parseRestoredThreadState(state);
    if (restoredThread) {
      this.runtime.thread.restoration.restore(restoredThread);
      return;
    }

    this.runtime.actions.invalidateThreadWork();
    this.runtime.thread.restoration.clear();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (!appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.observedAppServerContext = nextContext;
      void this.runtime.actions.reconnect();
      this.runtime.runtime.sharedState.applyCached();
    }
    this.mountOrRepairShell();
  }

  refreshSharedThreads(): Promise<void> {
    return this.runtime.actions.refreshSharedThreads();
  }

  canServeAppServerContext(context: AppServerQueryContext): boolean {
    const connectionContext = this.runtime.connection.manager.currentConnectionContext();
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
    const client = this.runtime.connection.manager.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const result = await operation(client);
    if (this.runtime.connection.manager.currentClient() !== client) {
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
      connected: this.runtime.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    if (!(await this.runtime.thread.ephemeral.prepareForPersistentNavigation())) return;
    this.ephemeralSourcePlaceholder = null;
    await this.runtime.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    const restoredThreadId = this.restoredThread()?.threadId ?? null;
    if ((threadId && this.runtime.thread.restoration.isPending(threadId)) || (!threadId && restoredThreadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    this.focusComposer();
  }

  async hydrateRestoredThread(): Promise<void> {
    await this.ensureRestoredThreadLoaded();
  }

  focusComposer(): void {
    this.runtime.composer.controller.focusComposer();
  }

  applyThreadArchived(threadId: string): void {
    this.runtime.thread.identity.applyThreadArchiveToActiveIdentity(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    const previousRestoredExplicitName = this.restoredThread()?.explicitName ?? null;
    this.runtime.thread.identity.applyThreadRenameToActiveIdentity(threadId, name);
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
    this.runtime.runtime.sharedState.subscribe();
    this.mountOrRepairShell();
    this.scheduleWarmup();
  }

  async close(): Promise<void> {
    this.opened = false;
    this.closing = true;
    const panelRoot = this.environment.view.panelRoot();
    await this.runtime.dispose(() => {
      unmountChatPanelShell(panelRoot);
    });
  }

  setComposerText(text: string): void {
    this.runtime.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.runtime.connection.actions.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    await this.runtime.actions.startNewThread();
    if (!this.state.activeThread.id) this.ephemeralSourcePlaceholder = null;
  }

  async openSideChat(input: { sourceThreadId: string; sourceThreadTitle: string | null }): Promise<boolean> {
    const opened = await this.runtime.thread.ephemeral.open(input);
    if (!opened) return false;
    this.ephemeralSourcePlaceholder = null;
    this.focusComposer();
    return true;
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
      parts: this.runtime.shell.parts,
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.runtime.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.runtime.connection.actions.ensureConnected();
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
    this.runtime.shell.closeToolbarPanelOnOutsidePointer(event);
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? threadMeaningfulTitle(thread) : (this.state.activeThread.title ?? null);
  }

  private restoredThreadTitle(): string | null {
    return this.restoredThread()?.title ?? null;
  }

  private restoredThread(): RestoredThreadPlaceholderState | null {
    return this.runtime.thread.restoration.placeholder();
  }

  private panelThreadId(): string | null {
    return this.restoredThread()?.threadId ?? this.state.activeThread.id;
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.runtime.thread.restoration.ensureLoaded((threadId) => this.runtime.thread.resume.resumeThread(threadId));
  }

  private createSessionRuntime(): ChatPanelSessionRuntime {
    return new ChatPanelSessionRuntime({
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

function parseEphemeralSourceState(state: unknown): { threadId: string; title: string | null } | null {
  if (!state || typeof state !== "object") return null;
  const source = (state as { ephemeralSource?: unknown }).ephemeralSource;
  if (!source || typeof source !== "object") return null;
  const threadId = (source as { threadId?: unknown }).threadId;
  const title = (source as { title?: unknown }).title;
  if (typeof threadId !== "string" || threadId.length === 0) return null;
  return { threadId, title: typeof title === "string" ? title : null };
}

function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): ChatWorkspacePanelTurnLifecycle {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}
