import type { ThreadTokenUsage } from "../../../../domain/runtime/usage";
import type { Thread, ThreadActivationSnapshot } from "../../../../domain/threads/model";
import { activeThreadState, awaitingResumeThreadState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { threadStreamIsEmpty } from "../state/thread-stream";
import { resumedThreadAction } from "../state/transition-actions";
import { chatThreadStreamViewState } from "../state/turn-scope";
import { type ForkDisplaySnapshot, reconcileForkDisplayItems } from "./fork-display-snapshot";
import type { HistoryController, ThreadHistoryPage } from "./history-controller";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ThreadHistoryPage | null;
  activeTurnId: string | null;
}

export interface ThreadResumeEffects {
  resumeThread(threadId: string, adopt: (snapshot: ThreadResumeSnapshot) => void): Promise<void>;
}

export interface ThreadActivationHost {
  stateStore: ChatStateStore;
  history: HistoryController;
  effects: ThreadResumeEffects;
  ensureConnected: () => Promise<boolean>;
  withThreadActivation<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  recordResumedThread: (thread: Thread) => void;
  addSystemMessage: (text: string) => void;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export interface ThreadResumeActivation {
  hydrate(): Promise<boolean>;
}

interface ActiveResume {
  readonly threadId: string;
  panelTarget: PanelTargetLease;
  loading: Promise<boolean> | null;
}

export class ThreadActivation {
  private current: ActiveResume | null = null;

  constructor(private readonly host: ThreadActivationHost) {}

  invalidate(): void {
    this.current = null;
  }

  async activate(threadId?: string, displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    const state = this.host.stateStore.getState();
    const targetThreadId = threadId ?? awaitingResumeThreadState(state)?.threadId;
    if (!targetThreadId) return false;

    const pending = this.current;
    if (pending?.loading && !this.isStaleResume(pending, pending.panelTarget)) {
      if (pending.threadId === targetThreadId) return pending.loading;
      if (threadId === undefined) return true;
    }
    if (activeThreadState(state)?.id === targetThreadId) {
      this.invalidate();
      return true;
    }
    return this.load(targetThreadId, displaySnapshot);
  }

  ensureRestoredThreadLoaded(displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    const restored = awaitingResumeThreadState(this.host.stateStore.getState());
    return restored ? this.load(restored.threadId, displaySnapshot) : Promise.resolve(true);
  }

  // Reconnect must resume even an already active thread. Adoption holds the
  // subscription boundary; the caller hydrates only after that boundary releases.
  resumeThread(threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<ThreadResumeActivation | null> {
    return this.beginResume(threadId, displaySnapshot)?.activation ?? Promise.resolve(null);
  }

  private async load(threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    const current = this.current;
    if (current?.threadId === threadId && current.loading && !this.isStaleResume(current, current.panelTarget)) return current.loading;
    const started = this.beginResume(threadId, displaySnapshot);
    if (!started) return false;
    const { resume, activation } = started;
    const loading = activation.then((result) => result?.hydrate() ?? false);
    resume.loading = loading;
    try {
      return await loading;
    } finally {
      // Keep the identity after hydration: rollout usage recovery may still be running.
      resume.loading = null;
    }
  }

  private beginResume(threadId: string, displaySnapshot?: ForkDisplaySnapshot) {
    if (!canSwitchToThread(this.host.stateStore.getState(), threadId)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return null;
    }
    const resume: ActiveResume = { threadId, panelTarget: capturePanelTargetLease(this.host.stateStore.getState()), loading: null };
    this.current = resume;
    return { resume, activation: this.resume(resume, displaySnapshot) };
  }

  private async resume(resume: ActiveResume, displaySnapshot?: ForkDisplaySnapshot): Promise<ThreadResumeActivation | null> {
    const { threadId, panelTarget: initialPanelTarget } = resume;
    this.host.history.invalidate();

    try {
      if (!(await this.host.ensureConnected())) return null;
      if (this.isStaleResume(resume, initialPanelTarget)) return null;
      return await this.host.withThreadActivation(threadId, async () => {
        if (this.isStaleResume(resume, initialPanelTarget)) return null;
        const adopted: { value: { snapshot: ThreadResumeSnapshot; panelTarget: PanelTargetLease } | null } = { value: null };
        await this.host.effects.resumeThread(threadId, (snapshot) => {
          this.host.recordResumedThread(snapshot.activation.thread);
          if (this.isStaleResume(resume, initialPanelTarget)) return;
          if (!canSwitchToThread(this.host.stateStore.getState(), resume.threadId)) return;
          const panelTarget = this.applyResumedThread(snapshot, initialPanelTarget.revision, displaySnapshot);
          if (panelTarget) {
            resume.panelTarget = panelTarget;
            adopted.value = { snapshot, panelTarget };
          }
        });
        const adoption = adopted.value;
        if (!adoption) return null;
        const { snapshot, panelTarget } = adoption;
        let hydration: Promise<boolean> | null = null;
        return {
          hydrate: () => {
            hydration ??= this.hydrateResumedThread(snapshot, resume, panelTarget, displaySnapshot);
            return hydration;
          },
        };
      });
    } catch (error) {
      if (this.isStaleResume(resume, initialPanelTarget)) return null;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async hydrateResumedThread(
    response: ThreadResumeSnapshot,
    resume: ActiveResume,
    panelTarget: PanelTargetLease,
    displaySnapshot?: ForkDisplaySnapshot,
  ): Promise<boolean> {
    try {
      if (this.isStaleResume(resume, panelTarget)) return false;
      this.recoverResumedThreadTokenUsage(response.activation.thread.id, response.rolloutPath, resume, panelTarget);
      const historyOptions = displaySnapshot ? { displayItems: displaySnapshot.items } : {};
      if (response.initialHistoryPage) {
        this.host.history.applyInitialPage(response.activation.thread.id, response.initialHistoryPage, historyOptions);
      } else {
        await this.host.history.loadLatest(response.activation.thread.id, historyOptions);
      }
      if (this.isStaleResume(resume, panelTarget)) return false;
      const state = this.host.stateStore.getState();
      const renderFallbackMessage = threadStreamIsEmpty(chatThreadStreamViewState(state.threadStream, state.activeTurn));
      if (renderFallbackMessage) {
        this.host.addSystemMessage(`Resumed thread ${response.activation.thread.id}`);
      }
      return true;
    } catch (error) {
      if (this.isStaleResume(resume, panelTarget)) return false;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private applyResumedThread(
    response: ThreadResumeSnapshot,
    expectedPanelTargetRevision: number,
    displaySnapshot?: ForkDisplaySnapshot,
  ): PanelTargetLease | null {
    const state = this.host.stateStore.dispatch(
      resumedThreadAction({
        response: response.activation,
        expectedPanelTargetRevision,
        items: response.initialHistoryPage
          ? reconcileForkDisplayItems(displaySnapshot?.items ?? [], response.initialHistoryPage.items)
          : (displaySnapshot?.items ?? []),
        activeTurnId: response.activeTurnId,
      }),
    );
    if (activeThreadState(state)?.id !== response.activation.thread.id) return null;
    if (displaySnapshot) {
      for (const [turnId, diff] of displaySnapshot.turnDiffs) {
        this.host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId, diff });
      }
    }
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    return capturePanelTargetLease(state);
  }

  private recoverResumedThreadTokenUsage(threadId: string, path: string | null, resume: ActiveResume, panelTarget: PanelTargetLease): void {
    if (!path || !this.host.recoverTokenUsageFromRollout) return;
    void this.host
      .recoverTokenUsageFromRollout(path)
      .then((tokenUsage) => {
        if (!tokenUsage || this.isStaleResume(resume, panelTarget)) return;
        const state = this.host.stateStore.getState();
        const activeThread = activeThreadState(state);
        if (!activeThread || activeThread.id !== threadId || activeThread.tokenUsage !== null) return;
        this.host.stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
      })
      .catch(() => undefined);
  }

  private isStaleResume(resume: ActiveResume, panelTarget: PanelTargetLease): boolean {
    return this.current !== resume || this.host.closing() || !panelTargetLeaseIsCurrent(this.host.stateStore.getState(), panelTarget);
  }
}
