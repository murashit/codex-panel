import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { Thread } from "../../../../domain/threads/model";
import { effectCompletedInCurrentContext } from "../effect-outcome";
import { resumedThreadAction } from "../state/actions";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamIsEmpty } from "../state/thread-stream";
import type { HistoryController } from "./history-controller";
import type { ActiveChatResume, ChatResumeWorkTracker } from "./resume-work";
import type { ThreadResumeSnapshot, ThreadResumeTransport } from "./thread-loading-transport";
import { canSwitchToThread } from "./thread-switching";

export interface ResumeActionsHost {
  stateStore: ChatStateStore;
  resumeWork: ChatResumeWorkTracker;
  history: HistoryController;
  resumeTransport: ThreadResumeTransport;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  recordResumedThread: (thread: Thread) => void;
  addSystemMessage: (text: string) => void;
  syncThreadGoal: (threadId: string) => Promise<void>;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export interface ResumeActions {
  resumeThread(threadId: string, intent?: ActiveChatResume, options?: ResumeThreadOptions): Promise<boolean>;
}

export interface ResumeThreadOptions {
  onAdopted?: () => void;
}

export function createResumeActions(host: ResumeActionsHost): ResumeActions {
  return {
    resumeThread: (threadId, intent, options) => resumeThread(host, threadId, intent, options),
  };
}

async function resumeThread(
  host: ResumeActionsHost,
  threadId: string,
  intent?: ActiveChatResume,
  options?: ResumeThreadOptions,
): Promise<boolean> {
  if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
    host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
    return false;
  }
  const resume = intent ?? host.resumeWork.begin(threadId);
  if (resume.threadId !== threadId || host.resumeWork.isStale(resume)) return false;
  const initialPanelTarget = capturePanelTargetLease(host.stateStore.getState());
  let currentPanelTarget = initialPanelTarget;
  host.history.invalidate();

  try {
    if (!(await host.resumeTransport.ensureConnected())) return false;
    if (isStaleResume(host, resume, initialPanelTarget)) return false;
    const effect = await host.resumeTransport.resumeThread(threadId);
    if (!effectCompletedInCurrentContext(effect)) return false;
    if (isStaleResume(host, resume, initialPanelTarget)) return false;
    const adoptedPanelTarget = applyResumedThread(host, effect.value, initialPanelTarget.revision);
    if (!adoptedPanelTarget) return false;
    currentPanelTarget = adoptedPanelTarget;
    host.recordResumedThread(effect.value.activation.thread);
    options?.onAdopted?.();
    recoverResumedThreadTokenUsage(host, effect.value.activation.thread.id, effect.value.rolloutPath, resume, adoptedPanelTarget);
    if (effect.value.initialHistoryPage) {
      host.history.applyLatestPage(effect.value.activation.thread.id, effect.value.initialHistoryPage);
    } else {
      await host.history.loadLatest(effect.value.activation.thread.id);
    }
    if (isStaleResume(host, resume, adoptedPanelTarget)) return false;
    await host.syncThreadGoal(effect.value.activation.thread.id);
    if (isStaleResume(host, resume, adoptedPanelTarget)) return false;
    const renderFallbackMessage = threadStreamIsEmpty(host.stateStore.getState().threadStream);
    if (renderFallbackMessage) {
      host.addSystemMessage(`Resumed thread ${effect.value.activation.thread.id}`);
    }
    return true;
  } catch (error) {
    if (isStaleResume(host, resume, currentPanelTarget)) return false;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function applyResumedThread(
  host: ResumeActionsHost,
  response: ThreadResumeSnapshot,
  expectedPanelTargetRevision: number,
): PanelTargetLease | null {
  const state = host.stateStore.dispatch(
    resumedThreadAction({
      response: response.activation,
      listedThreads: host.stateStore.getState().threadList.listedThreads,
      expectedPanelTargetRevision,
    }),
  );
  if (activeThreadState(state)?.id !== response.activation.thread.id) return null;
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  return capturePanelTargetLease(state);
}

function recoverResumedThreadTokenUsage(
  host: ResumeActionsHost,
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

function isStaleResume(host: ResumeActionsHost, resume: ActiveChatResume, panelTarget?: PanelTargetLease): boolean {
  return (
    host.resumeWork.isStale(resume) ||
    host.closing() ||
    Boolean(panelTarget && !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget))
  );
}
