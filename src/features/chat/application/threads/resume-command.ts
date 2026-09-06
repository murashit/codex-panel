import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { Thread } from "../../../../domain/threads/model";
import type { EffectOutcome } from "../effect-outcome";
import { activeThreadState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { threadStreamIsEmpty } from "../state/thread-stream";
import { resumedThreadAction } from "../state/transition-actions";
import { chatThreadStreamViewState } from "../state/turn-scope";
import type { ForkDisplaySnapshot } from "./fork-display-snapshot";
import type { HistoryController, ThreadHistoryPage } from "./history-controller";
import type { ActiveChatResume, ChatResumeWorkTracker } from "./resume-work";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ThreadHistoryPage | null;
}

export interface ThreadResumeEffects {
  resumeThread(threadId: string): Promise<EffectOutcome<ThreadResumeSnapshot>>;
}

export interface ResumeCommandHost {
  stateStore: ChatStateStore;
  resumeWork: ChatResumeWorkTracker;
  history: HistoryController;
  effects: ThreadResumeEffects;
  ensureConnected: () => Promise<boolean>;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  recordResumedThread: (thread: Thread) => void;
  addSystemMessage: (text: string) => void;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export interface ResumeCommand {
  resumeThread(threadId: string, intent?: ActiveChatResume, displaySnapshot?: ForkDisplaySnapshot): Promise<ThreadResumeActivation | null>;
}

export interface ThreadResumeActivation {
  hydrate(): Promise<boolean>;
}

export function createResumeCommand(host: ResumeCommandHost): ResumeCommand {
  return {
    resumeThread: (threadId, intent, displaySnapshot) => resumeThread(host, threadId, intent, displaySnapshot),
  };
}

async function resumeThread(
  host: ResumeCommandHost,
  threadId: string,
  intent?: ActiveChatResume,
  displaySnapshot?: ForkDisplaySnapshot,
): Promise<ThreadResumeActivation | null> {
  if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
    host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
    return null;
  }
  const resume = intent ?? host.resumeWork.begin(threadId);
  if (resume.threadId !== threadId || !host.resumeWork.isCurrent(resume)) return null;
  const initialPanelTarget = capturePanelTargetLease(host.stateStore.getState());
  host.history.invalidate();

  try {
    if (!(await host.ensureConnected())) return null;
    if (isStaleResume(host, resume, initialPanelTarget)) return null;
    const effect = await host.effects.resumeThread(threadId);
    if (effect.kind === "not-started") return null;
    host.recordResumedThread(effect.value.activation.thread);
    if (isStaleResume(host, resume, initialPanelTarget)) return null;
    if (!host.resumeWork.canCommit(resume, host.stateStore.getState())) return null;
    const adoptedPanelTarget = applyResumedThread(host, effect.value, initialPanelTarget.revision, displaySnapshot);
    if (!adoptedPanelTarget) return null;
    let hydration: Promise<boolean> | null = null;
    return {
      hydrate: () => {
        hydration ??= hydrateResumedThread(host, effect.value, resume, adoptedPanelTarget, displaySnapshot);
        return hydration;
      },
    };
  } catch (error) {
    if (isStaleResume(host, resume, initialPanelTarget)) return null;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function hydrateResumedThread(
  host: ResumeCommandHost,
  response: ThreadResumeSnapshot,
  resume: ActiveChatResume,
  panelTarget: PanelTargetLease,
  displaySnapshot?: ForkDisplaySnapshot,
): Promise<boolean> {
  try {
    if (isStaleResume(host, resume, panelTarget)) return false;
    recoverResumedThreadTokenUsage(host, response.activation.thread.id, response.rolloutPath, resume, panelTarget);
    if (response.initialHistoryPage) {
      if (displaySnapshot) {
        host.history.applyLatestPage(response.activation.thread.id, response.initialHistoryPage, { displayItems: displaySnapshot.items });
      } else {
        host.history.applyLatestPage(response.activation.thread.id, response.initialHistoryPage);
      }
    } else {
      if (displaySnapshot) {
        await host.history.loadLatest(response.activation.thread.id, { displayItems: displaySnapshot.items });
      } else {
        await host.history.loadLatest(response.activation.thread.id);
      }
    }
    if (isStaleResume(host, resume, panelTarget)) return false;
    const state = host.stateStore.getState();
    const renderFallbackMessage = threadStreamIsEmpty(chatThreadStreamViewState(state.threadStream, state.activeTurn));
    if (renderFallbackMessage) {
      host.addSystemMessage(`Resumed thread ${response.activation.thread.id}`);
    }
    return true;
  } catch (error) {
    if (isStaleResume(host, resume, panelTarget)) return false;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function applyResumedThread(
  host: ResumeCommandHost,
  response: ThreadResumeSnapshot,
  expectedPanelTargetRevision: number,
  displaySnapshot?: ForkDisplaySnapshot,
): PanelTargetLease | null {
  const state = host.stateStore.dispatch(
    resumedThreadAction({
      response: response.activation,
      expectedPanelTargetRevision,
      ...(displaySnapshot ? { items: displaySnapshot.items } : {}),
    }),
  );
  if (activeThreadState(state)?.id !== response.activation.thread.id) return null;
  if (displaySnapshot) {
    for (const [turnId, diff] of displaySnapshot.turnDiffs) {
      host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId, diff });
    }
  }
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  return capturePanelTargetLease(state);
}

function recoverResumedThreadTokenUsage(
  host: ResumeCommandHost,
  threadId: string,
  path: string | null,
  resume: ActiveChatResume,
  panelTarget: PanelTargetLease,
): void {
  if (!path || !host.recoverTokenUsageFromRollout) return;
  void host
    .recoverTokenUsageFromRollout(path)
    .then((tokenUsage) => {
      if (!tokenUsage || isStaleResume(host, resume, panelTarget)) return;
      const state = host.stateStore.getState();
      const activeThread = activeThreadState(state);
      if (!activeThread || activeThread.id !== threadId || activeThread.tokenUsage !== null) return;
      host.stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
    })
    .catch(() => undefined);
}

function isStaleResume(host: ResumeCommandHost, resume: ActiveChatResume, panelTarget?: PanelTargetLease): boolean {
  return (
    !host.resumeWork.isCurrent(resume) ||
    host.closing() ||
    Boolean(panelTarget && !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget))
  );
}
