import { hasPendingRequests, pendingRequestCountsFromQueues } from "../../../../domain/pending-requests/aggregate";
import { threadMeaningfulTitle, threadWindowTitle } from "../../../../domain/threads/title";
import {
  activeThreadState,
  awaitingResumeThreadState,
  type ChatState,
  panelThreadId,
  panelThreadProvenance,
} from "../../application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../application/state/store";
import { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { chatTurnBusy } from "../../application/turns/turn-state";
import { renderChatPanelShell, unmountChatPanelShell } from "../../panel/shell/render.dom";
import { type ChatThreadStreamScrollBinding, createChatThreadStreamScrollBinding } from "../../panel/thread-stream/scroll-binding";
import type { ChatPanelEnvironment, ChatPanelHandle, ChatPanelRuntimeSnapshot, ChatWorkspacePanelSnapshot } from "../contracts";
import { parseChatPanelViewState } from "../view-state";
import { type ChatViewDeferredTasks, createChatViewDeferredTasks } from "./deferred-work";
import { createChatPanelSessionRuntime } from "./runtime";

export class ChatPanelSession implements ChatPanelHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly runtime: ReturnType<typeof createChatPanelSessionRuntime>;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly threadStreamScrollBinding: ChatThreadStreamScrollBinding = createChatThreadStreamScrollBinding();
  private opened = false;
  private closing = false;
  private observedPanelActivity: PanelActivity | null = null;
  private unsubscribePanelActivity: (() => void) | null = null;
  private pendingRuntimeRestore: ChatPanelRuntimeSnapshot | null;
  private pendingEphemeralSource: { threadId: string; title: string | null } | null = null;

  constructor(
    private readonly environment: ChatPanelEnvironment,
    snapshot: ChatPanelRuntimeSnapshot | null = null,
  ) {
    this.pendingRuntimeRestore = snapshot;
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.runtime = this.createSessionRuntime();
    if (snapshot) {
      this.applyViewState(snapshot.viewState);
      if (!snapshot.ephemeralSource) this.runtime.composer.controller.restoreRuntimeSnapshot(snapshot.composer);
    }
  }

  displayTitle(): string {
    if (this.pendingEphemeralSource || activeThreadState(this.state)?.lifetime?.kind === "ephemeral") {
      return "Side chat";
    }
    return threadWindowTitle(this.panelThreadId(), this.sharedThreads(), this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    if (this.pendingEphemeralSource) {
      return {
        version: 2,
        ephemeralSource: this.pendingEphemeralSource,
      };
    }
    const lifetime = activeThreadState(this.state)?.lifetime;
    if (lifetime?.kind === "ephemeral") {
      return {
        version: 2,
        ephemeralSource: { threadId: lifetime.sourceThreadId, title: lifetime.sourceThreadTitle },
      };
    }
    if (panelThreadProvenance(this.state)?.kind === "subagent") return { version: 1 };
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
    const restoredState = parseChatPanelViewState(state);
    this.runtime.commands.invalidateThreadWork();
    this.clearPendingEphemeralIntent();
    if (restoredState.kind === "thread") {
      this.stateStore.dispatch({
        type: "panel/restored-thread-applied",
        threadId: restoredState.threadId,
        fallbackTitle: restoredState.fallbackTitle,
      });
      this.environment.view.refreshTabHeader();
      return;
    }

    this.stateStore.dispatch({ type: "panel/view-state-cleared" });
    this.environment.view.refreshTabHeader();
    this.scheduleWarmup();
  }

  refreshSettings(): void {
    this.mountOrRepairShell();
  }

  runtimeSnapshot(): ChatPanelRuntimeSnapshot {
    const lifetime = activeThreadState(this.state)?.lifetime;
    const composer = this.runtime.composer.controller.runtimeSnapshot();
    return {
      viewState: this.persistedState(),
      composer,
      ephemeralSource:
        this.pendingEphemeralSource ??
        (lifetime?.kind === "ephemeral" ? { threadId: lifetime.sourceThreadId, title: lifetime.sourceThreadTitle } : null),
    };
  }

  refreshSharedThreads(): Promise<void> {
    return this.runtime.commands.refreshSharedThreads();
  }

  openPanelSnapshot(): ChatWorkspacePanelSnapshot {
    const activity = panelActivity(this.state);
    const preparingEphemeralThread = this.pendingEphemeralSource !== null;
    return {
      viewId: this.environment.obsidian.viewId,
      ...activity,
      pending: activity.pending || preparingEphemeralThread,
      threadId: this.closing ? null : activity.threadId,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.runtime.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string, options: { focus?: boolean } = {}): Promise<void> {
    this.clearPendingEphemeralIntent();
    const intent = this.resumeWork.begin(threadId);
    const preparation = await this.runtime.thread.navigation.prepareForPersistentNavigation(threadId);
    if (!preparation || !this.resumeWork.isCurrent(intent)) return;
    if (
      !(await this.runtime.thread.resume.resumeThread(threadId, intent, {
        onAdopted: () => {
          this.runtime.thread.navigation.commitPersistentNavigation(preparation);
        },
      })) ||
      !this.resumeWork.isCurrent(intent)
    )
      return;
    if (options.focus !== false) this.focusComposer();
  }

  async focusThread(threadId: string | null = null, options: { focus?: boolean } = {}): Promise<void> {
    const restoredThread = this.restoredThread();
    const restoredThreadId = restoredThread?.threadId ?? null;
    if ((threadId && this.runtime.thread.restoration.isPending(threadId)) || (!threadId && restoredThreadId)) {
      await this.ensureRestoredThreadLoaded();
    }
    if (options.focus !== false) this.focusComposer();
  }

  async hydrateRestoredThread(): Promise<void> {
    await this.ensureRestoredThreadLoaded();
  }

  focusComposer(options: { force?: boolean } = {}): void {
    this.runtime.composer.controller.focusComposer(options);
  }

  applyThreadUnavailable(threadId: string): void {
    this.runtime.thread.identity.applyThreadUnavailableToActiveIdentity(threadId);
  }

  applyThreadRenamed(threadId: string, name: string | null): void {
    this.runtime.thread.identity.applyThreadRenameToActiveIdentity(threadId, name);
  }

  open(): void {
    this.opened = true;
    this.closing = false;
    this.observePanelActivity();
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.runtime.observers.threadCatalog.subscribe();
    this.mountOrRepairShell();
    this.scheduleWarmup();
    this.restoreRuntimeSnapshot();
  }

  async close(): Promise<void> {
    this.opened = false;
    this.closing = true;
    this.unsubscribePanelActivity?.();
    this.unsubscribePanelActivity = null;
    this.observedPanelActivity = null;
    const disposal = this.runtime.dispose(() => {
      unmountChatPanelShell(this.environment.view.panelRoot());
    });
    this.notifyPanelActivityChanged();
    this.viewWindow().setTimeout(() => {
      this.notifyPanelActivityChanged();
    }, 0);
    await disposal;
  }

  setComposerText(text: string): void {
    this.runtime.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.runtime.connection.coordinator.ensureHydrated();
  }

  async startNewThread(options: { focus?: boolean } = {}): Promise<void> {
    this.clearPendingEphemeralIntent();
    await this.runtime.commands.startNewThread(options);
  }

  async openSideChat(
    input: { sourceThreadId: string; sourceThreadTitle: string | null },
    options: { focus?: boolean } = {},
  ): Promise<boolean> {
    const intent = this.resumeWork.begin(null);
    const pendingSource = { threadId: input.sourceThreadId, title: input.sourceThreadTitle };
    this.setPendingEphemeralSource(pendingSource);
    try {
      const opened = await this.runtime.thread.ephemeral.open(input, {
        isCurrent: () => this.resumeWork.isCurrent(intent),
      });
      if (!opened) return false;
      if (options.focus !== false) this.focusComposer();
      return true;
    } finally {
      if (this.pendingEphemeralSource === pendingSource) {
        this.setPendingEphemeralSource(null);
      }
    }
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private mountOrRepairShell(): void {
    const root = this.environment.view.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: this.stateStore,
      appServerQueries: this.environment.plugin.appServerQueries,
      threadCatalog: this.environment.plugin.threadCatalog,
      showToolbar: this.environment.plugin.settings.showToolbar(),
      parts: this.runtime.shell.parts,
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.runtime.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.deferredTasks.scheduleAppServerWarmup(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.runtime.connection.coordinator.ensureHydrated();
    });
  }

  private restoreRuntimeSnapshot(): void {
    const snapshot = this.pendingRuntimeRestore;
    if (!snapshot) return;
    this.pendingRuntimeRestore = null;
    if (snapshot.ephemeralSource) {
      void this.openSideChat(
        {
          sourceThreadId: snapshot.ephemeralSource.threadId,
          sourceThreadTitle: snapshot.ephemeralSource.title,
        },
        { focus: false },
      ).then((opened) => {
        if (opened && !this.closing) this.runtime.composer.controller.restoreRuntimeSnapshot(snapshot.composer);
      });
      return;
    }
    if (parseChatPanelViewState(snapshot.viewState).kind === "thread") {
      void this.ensureRestoredThreadLoaded();
    }
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.runtime.shell.closeToolbarPanelOnOutsidePointer(event);
  }

  private observePanelActivity(): void {
    this.unsubscribePanelActivity?.();
    this.observedPanelActivity = panelActivity(this.state);
    this.unsubscribePanelActivity = this.stateStore.subscribe(() => {
      const next = panelActivity(this.state);
      if (panelActivityEquals(this.observedPanelActivity, next)) return;
      this.observedPanelActivity = next;
      this.notifyPanelActivityChanged();
    });
    this.notifyPanelActivityChanged();
  }

  private notifyPanelActivityChanged(): void {
    this.environment.plugin.workspace.notifyPanelActivityChanged();
  }

  private clearPendingEphemeralIntent(): void {
    if (this.pendingEphemeralSource) this.setPendingEphemeralSource(null);
  }

  private setPendingEphemeralSource(source: { threadId: string; title: string | null } | null): void {
    this.pendingEphemeralSource = source;
    this.environment.view.refreshTabHeader();
    this.notifyPanelActivityChanged();
  }

  private activeThreadTitle(): string | null {
    const activeThread = activeThreadState(this.state);
    if (!activeThread) return null;
    const threadId = activeThread.id;
    const thread = this.sharedThreads().find((item) => item.id === threadId);
    return thread ? threadMeaningfulTitle(thread) : (activeThread.title ?? null);
  }

  private restoredThreadTitle(): string | null {
    const restoredThread = this.restoredThread();
    if (!restoredThread) return null;
    const listedThread = this.sharedThreads().find((thread) => thread.id === restoredThread.threadId);
    return listedThread ? threadMeaningfulTitle(listedThread) : restoredThread.fallbackTitle;
  }

  private restoredThread(): ReturnType<typeof awaitingResumeThreadState> {
    return awaitingResumeThreadState(this.state);
  }

  private panelThreadId(): string | null {
    return panelThreadId(this.state);
  }

  private sharedThreads() {
    return this.environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [];
  }

  private ensureRestoredThreadLoaded(): Promise<boolean> {
    return this.runtime.thread.restoration.ensureLoaded(async (threadId) => {
      await this.runtime.thread.resume.resumeThread(threadId);
    });
  }

  private createSessionRuntime(): ReturnType<typeof createChatPanelSessionRuntime> {
    return createChatPanelSessionRuntime({
      environment: this.environment,
      stateStore: this.stateStore,
      deferredTasks: this.deferredTasks,
      resumeWork: this.resumeWork,
      threadStreamScrollBinding: this.threadStreamScrollBinding,
      getClosing: () => this.closing,
    });
  }
}

interface PanelActivity {
  readonly threadId: string | null;
  readonly turnBusy: boolean;
  readonly pending: boolean;
}

function panelActivity(state: ChatState): PanelActivity {
  return {
    threadId: panelThreadId(state),
    turnBusy: chatTurnBusy(state),
    pending: hasPendingRequests(pendingRequestCountsFromQueues(state.requests)),
  };
}

function panelActivityEquals(left: PanelActivity | null, right: PanelActivity): boolean {
  return left !== null && left.threadId === right.threadId && left.turnBusy === right.turnBusy && left.pending === right.pending;
}
