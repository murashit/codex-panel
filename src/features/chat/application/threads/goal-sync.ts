import type { ThreadGoal } from "../../../../domain/threads/goal";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import type { GoalThreadStreamItem } from "../../domain/thread-stream/items";
import type { LocalIdSource } from "../local-id-source";
import { activeThreadId, activeThreadState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";

export interface ThreadGoalSource {
  readThreadGoal(threadId: string): Promise<ThreadGoal | null | undefined>;
}

export interface ThreadGoalProjectionHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalThreadStreamItem) => void;
}

export interface ThreadGoalSyncHost extends ThreadGoalProjectionHost {
  source: ThreadGoalSource;
}

export interface ThreadGoalSync {
  syncThreadGoal: (threadId: string) => Promise<void>;
  observeThreadGoal: (threadId: string) => void;
}

export function createThreadGoalSync(host: ThreadGoalSyncHost): ThreadGoalSync {
  let observationRevision = 0;
  return {
    async syncThreadGoal(threadId) {
      const readRevision = observationRevision;
      const panelTarget = capturePanelTargetLease(host.stateStore.getState());
      try {
        const goal = await host.source.readThreadGoal(threadId);
        if (goal === undefined || observationRevision !== readRevision) return;
        applyThreadGoalIfActive(host, threadId, goal, { reportChange: false, panelTarget });
      } catch (error) {
        if (observationRevision !== readRevision) return;
        addThreadGoalSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`, panelTarget);
      }
    },
    observeThreadGoal: (threadId) => {
      if (activeThreadId(host.stateStore.getState()) === threadId) observationRevision += 1;
    },
  };
}

export function applyThreadGoalIfActive(
  host: ThreadGoalProjectionHost,
  threadId: string,
  goal: ThreadGoal | null,
  options: { reportChange: boolean; panelTarget?: PanelTargetLease },
): boolean {
  const state = host.stateStore.getState();
  if (options.panelTarget && !panelTargetLeaseIsCurrent(state, options.panelTarget)) return false;
  const activeThread = activeThreadState(state);
  if (!activeThread || activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(host.localItemIds.next("goal"), activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  return true;
}

export function addThreadGoalSystemMessage(
  host: Pick<ThreadGoalProjectionHost, "stateStore" | "addSystemMessage">,
  threadId: string,
  text: string,
  panelTarget?: PanelTargetLease,
): void {
  const state = host.stateStore.getState();
  if ((panelTarget && !panelTargetLeaseIsCurrent(state, panelTarget)) || activeThreadId(state) !== threadId) return;
  host.addSystemMessage(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
