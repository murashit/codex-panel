import { Notice } from "obsidian";
import { codexTextInput } from "../../../../domain/input/input";
import { threadMeaningfulTitle, threadWindowTitle } from "../../../../domain/threads/title";
import { DeferredTask } from "../../../../shared/async/deferred-task";
import { disposeDomListeners, listenDomEvent } from "../../../../shared/ui/events.dom";
import {
  activeThreadState,
  awaitingResumeThreadState,
  type ChatState,
  isSideChatLifetime,
  panelThreadId,
  panelThreadProvenance,
} from "../../application/state/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../../application/state/panel-target";
import { type ChatStateStore, createChatStateStore } from "../../application/state/store";
import type { ForkDisplaySnapshot } from "../../application/threads/fork-display-snapshot";
import type { ForkDraftPreparation } from "../../application/threads/fork-draft";
import { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { canSwitchToThread } from "../../application/threads/thread-switching";
import { chatTurnBusy } from "../../application/turns/turn-state";
import { hasPendingRequests, pendingRequestCountsFromQueues } from "../../domain/pending-requests/aggregate";
import { confirmForkDiscard } from "../composer/confirm-fork-discard.obsidian";
import type { ChatPanelEnvironment, ChatPanelHandle, ChatWorkspacePanelSnapshot } from "../contracts";
import { renderChatPanelShell, unmountChatPanelShell } from "../shell/render.dom";
import { type ChatThreadStreamScrollBinding, createChatThreadStreamScrollBinding } from "../thread-stream/scroll-binding";
import { parseChatPanelViewState } from "../view-state";
import { createChatPanelSessionRuntime } from "./runtime";

export class ChatPanelSession implements ChatPanelHandle {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly runtime: ReturnType<typeof createChatPanelSessionRuntime>;

  private readonly appServerWarmup: DeferredTask;
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly threadStreamScrollBinding: ChatThreadStreamScrollBinding = createChatThreadStreamScrollBinding();
  private opened = false;
  private closing = false;
  private observedPanelActivity: PanelActivity | null = null;
  private unsubscribePanelActivity: (() => void) | null = null;
  private foregroundWindow: Window | null = null;
  private stopObservingForeground: (() => void) | null = null;
  private pendingPersistentActivation: { threadId: string; promise: Promise<boolean> } | null = null;

  constructor(
    private readonly environment: ChatPanelEnvironment,
    viewState: Record<string, unknown> | null = null,
  ) {
    this.appServerWarmup = new DeferredTask(() => this.viewWindow(), 0);
    this.stateStore.dispatch({ type: "panel/ephemeral-default-set", ephemeral: environment.plugin.settings.newConversationsEphemeral() });
    this.runtime = this.createSessionRuntime();
    if (viewState) {
      this.applyViewState(viewState);
    }
  }

  displayTitle(): string {
    const draft = this.state.panelThread.kind === "fork-draft" ? this.state.panelThread.draft : null;
    if (draft) return draft.kind === "side-chat" ? "Side chat" : "Fork draft";
    if (isSideChatLifetime(activeThreadState(this.state)?.lifetime)) return "Side chat";
    return threadWindowTitle(panelThreadId(this.state), this.sharedThreads(), this.activeThreadTitle() ?? this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    if (activeThreadState(this.state)?.lifetime?.kind === "ephemeral") return { version: 1 };
    if (panelThreadProvenance(this.state)?.kind === "subagent") return { version: 1 };
    const threadId = panelThreadId(this.state);
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
    this.pendingPersistentActivation = null;
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
    this.stateStore.dispatch({
      type: "panel/ephemeral-default-set",
      ephemeral: this.environment.plugin.settings.newConversationsEphemeral(),
    });
    this.mountOrRepairShell();
  }

  refreshSharedThreads(): Promise<void> {
    return this.runtime.commands.refreshSharedThreads();
  }

  openPanelSnapshot(): ChatWorkspacePanelSnapshot {
    const activity = panelActivity(this.state);
    return {
      viewId: this.environment.obsidian.viewId,
      ...activity,
      threadId: this.closing ? null : activity.threadId,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      hasForkDraft: this.state.panelThread.kind === "fork-draft",
      connected: this.runtime.connection.manager.isConnected(),
    };
  }

  async applyForkDraft(preparation: ForkDraftPreparation, initialMessage?: string): Promise<boolean> {
    if (this.closing || !canSwitchToThread(this.state, null)) return false;
    this.runtime.commands.invalidateThreadWork();
    this.pendingPersistentActivation = null;
    this.stateStore.dispatch({ type: "panel/fork-draft-applied", preparation });
    this.environment.view.refreshTabHeader();
    this.environment.obsidian.requestWorkspaceLayoutSave();
    const text = initialMessage?.trim();
    if (!text) return true;
    const submissionClaim = this.runtime.composer.input.claimTextSubmission(text);
    if (!submissionClaim) return false;
    return this.runtime.turn.submissionCommands.sendTurnText({ preparedInput: { text, input: codexTextInput(text) }, submissionClaim });
  }

  private async cancelForkDraft(): Promise<void> {
    const state = this.state;
    const panel = state.panelThread;
    if (
      panel.kind !== "fork-draft" ||
      panel.operation ||
      state.pendingSubmission ||
      state.composer.pendingAttachmentSaveIds.length ||
      this.runtime.composer.input.isSubmissionPreparing()
    )
      return;
    const target = capturePanelTargetLease(state);
    const isCurrent = () => !this.closing && panelTargetLeaseIsCurrent(this.state, target);
    this.stateStore.dispatch({ type: "panel/fork-operation-set", revision: target.revision, operation: "cancelling" });
    try {
      if (state.composer.draft !== (panel.draft.initialPrompt ?? "") && !(await confirmForkDiscard(this.environment.obsidian.app))) return;
      if (!isCurrent() || this.state.composer.draft !== state.composer.draft || this.state.composer.pendingAttachmentSaveIds.length) return;
      const returned = await this.environment.plugin.workspace.returnFromForkDraft(
        panel.draft.sourceThreadId,
        this.environment.obsidian.viewId,
        isCurrent,
      );
      if (!returned && isCurrent()) new Notice("Could not return to the source thread. Your draft was kept.");
    } catch (error) {
      if (isCurrent()) new Notice(`Could not return to the source thread: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (isCurrent()) {
        this.stateStore.dispatch({ type: "panel/fork-operation-set", revision: target.revision });
        this.focusComposer();
      }
    }
  }

  async activateThread(threadId?: string, options: { focus?: boolean; displaySnapshot?: ForkDisplaySnapshot } = {}): Promise<boolean> {
    const restoredThread = awaitingResumeThreadState(this.state);
    const restoredThreadId = restoredThread?.threadId ?? null;
    const targetThreadId = threadId ?? restoredThreadId;
    if (!targetThreadId) {
      if (options.focus !== false) this.focusComposer();
      return false;
    }

    const pending = this.pendingPersistentActivation;
    if (pending?.threadId === targetThreadId) {
      const activated = await pending.promise;
      if (activated && options.focus !== false) this.focusComposer();
      return activated;
    }
    if (threadId === undefined && pending) {
      if (options.focus !== false) this.focusComposer();
      return true;
    }
    if (activeThreadState(this.state)?.id === targetThreadId) {
      this.resumeWork.begin(targetThreadId);
      if (pending) {
        this.pendingPersistentActivation = null;
      }
      if (options.focus !== false) this.focusComposer();
      return true;
    }

    const activation = {
      threadId: targetThreadId,
      promise: this.activatePersistentThread(targetThreadId, options.displaySnapshot),
    };
    this.pendingPersistentActivation = activation;
    let activated: boolean;
    try {
      activated = await activation.promise;
    } finally {
      if (this.pendingPersistentActivation === activation) this.pendingPersistentActivation = null;
    }
    if (activated && options.focus !== false) this.focusComposer();
    return activated;
  }

  private async activatePersistentThread(threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    if (this.runtime.thread.restoration.isPending(threadId)) {
      return this.runtime.thread.ensureRestoredThreadLoaded(displaySnapshot);
    }
    const intent = this.resumeWork.begin(threadId);
    const activation = await this.runtime.thread.resume.resumeThread(threadId, intent, displaySnapshot);
    if (!activation) return false;
    if (!(await activation.hydrate()) || !this.resumeWork.isCurrent(intent)) return false;
    return true;
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
    if (this.closing) return;
    this.opened = true;
    this.observePanelActivity();
    const activate = () => {
      this.observeForegroundWindow();
      this.runtime.threadReadState.activate();
    };
    const workspace = this.environment.obsidian.app.workspace;
    this.environment.obsidian.registerEvent(workspace.on("active-leaf-change", activate));
    this.environment.obsidian.registerEvent(
      workspace.on("layout-change", () => {
        if (this.observeForegroundWindow()) this.runtime.threadReadState.activate();
      }),
    );
    activate();
    this.environment.obsidian.registerPointerDown((event) => {
      this.closeToolbarPanelOnOutsidePointer(event);
    });
    this.runtime.observers.threadCatalog.subscribe();
    this.mountOrRepairShell();
    this.scheduleWarmup();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.opened = false;
    this.closing = true;
    const disposal = this.runtime.dispose(() => {
      unmountChatPanelShell(this.environment.view.panelRoot());
    });
    try {
      this.stopObservingForeground?.();
      this.stopObservingForeground = null;
      this.foregroundWindow = null;
      this.unsubscribePanelActivity?.();
      this.unsubscribePanelActivity = null;
      this.observedPanelActivity = null;
      this.notifyPanelActivityChanged();
      this.viewWindow().setTimeout(() => {
        this.notifyPanelActivityChanged();
      }, 0);
    } finally {
      await disposal;
    }
  }

  setComposerText(text: string): void {
    this.runtime.composer.input.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.runtime.connection.coordinator.ensureHydrated();
  }

  async startNewThread(options: { focus?: boolean } = {}): Promise<void> {
    await this.runtime.commands.startNewThread(options);
    if (panelThreadId(this.state) === null) {
      this.pendingPersistentActivation = null;
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
      toolInventoryQueries: this.environment.plugin.toolInventoryQueries,
      threadGoalQueries: this.environment.plugin.threadGoalQueries,
      threadCatalog: this.environment.plugin.threadCatalog,
      showToolbar: this.environment.plugin.settings.showToolbar(),
      parts: this.runtime.shell.parts,
    });
  }

  private scheduleWarmup(): void {
    const shouldWarmup = (): boolean => this.opened && !this.runtime.connection.manager.isConnected();
    if (!shouldWarmup()) return;

    this.appServerWarmup.schedule(() => {
      if (!shouldWarmup() || this.closing) return;
      void this.runtime.connection.coordinator.ensureHydrated();
    });
  }

  private observeForegroundWindow(): boolean {
    if (this.closing) return false;
    const win = this.viewWindow();
    if (win === this.foregroundWindow) return false;
    this.stopObservingForeground?.();
    this.foregroundWindow = win;
    const activate = () => {
      this.runtime.threadReadState.activate();
    };
    this.stopObservingForeground = disposeDomListeners(
      listenDomEvent(win, "focus", activate),
      listenDomEvent(win.document, "visibilitychange", activate),
    );
    return true;
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

  private activeThreadTitle(): string | null {
    const activeThread = activeThreadState(this.state);
    if (!activeThread) return null;
    const threadId = activeThread.id;
    const thread = this.sharedThreads().find((item) => item.id === threadId);
    return thread ? threadMeaningfulTitle(thread) : threadMeaningfulTitle(activeThread);
  }

  private restoredThreadTitle(): string | null {
    const restoredThread = awaitingResumeThreadState(this.state);
    if (!restoredThread) return null;
    const listedThread = this.sharedThreads().find((thread) => thread.id === restoredThread.threadId);
    return listedThread ? threadMeaningfulTitle(listedThread) : restoredThread.fallbackTitle;
  }

  private sharedThreads() {
    return this.environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [];
  }

  private createSessionRuntime(): ReturnType<typeof createChatPanelSessionRuntime> {
    return createChatPanelSessionRuntime({
      environment: this.environment,
      stateStore: this.stateStore,
      appServerWarmup: this.appServerWarmup,
      resumeWork: this.resumeWork,
      threadStreamScrollBinding: this.threadStreamScrollBinding,
      getClosing: () => this.closing,
      applyForkDraft: async (preparation) => {
        await this.applyForkDraft(preparation);
      },
      cancelForkDraft: () => void this.cancelForkDraft(),
    });
  }
}

interface PanelActivity {
  readonly threadId: string | null;
  readonly turnBusy: boolean;
  readonly pending: boolean;
  readonly unread: boolean;
  readonly hasForkDraft: boolean;
}

function panelActivity(state: ChatState): PanelActivity {
  return {
    threadId: panelThreadId(state),
    hasForkDraft: state.panelThread.kind === "fork-draft",
    turnBusy: chatTurnBusy(state.activeTurn),
    unread: state.threadReadReceipt?.unread ?? false,
    pending: hasPendingRequests(pendingRequestCountsFromQueues(state.requests)),
  };
}

function panelActivityEquals(left: PanelActivity | null, right: PanelActivity): boolean {
  return (
    left !== null &&
    left.threadId === right.threadId &&
    left.turnBusy === right.turnBusy &&
    left.pending === right.pending &&
    left.unread === right.unread &&
    left.hasForkDraft === right.hasForkDraft
  );
}
