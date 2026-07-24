import type { ThreadGoal } from "../../../../domain/threads/goal";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import type { GoalThreadStreamItem } from "../../domain/thread-stream/items";
import type { LocalIdSource } from "../local-id-source";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ThreadGoalReadPort } from "./goal-ports";
import { createThreadGoalCoordinator, type ThreadGoalCoordinator } from "./thread-goal-coordinator";

export interface ThreadGoalSyncHost {
  stateStore: ChatStateStore;
  goalPort: ThreadGoalReadPort;
  localItemIds: LocalIdSource;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalThreadStreamItem) => void;
}

export interface ThreadGoalSync {
  syncThreadGoal: (threadId: string) => Promise<void>;
}

export function createThreadGoalSync(
  host: ThreadGoalSyncHost,
  goalCoordinator: ThreadGoalCoordinator = createThreadGoalCoordinator(),
): ThreadGoalSync {
  return {
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId, goalCoordinator),
  };
}

async function syncThreadGoal(host: ThreadGoalSyncHost, threadId: string, goalCoordinator: ThreadGoalCoordinator): Promise<void> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const readRevision = goalCoordinator.captureReadRevision(threadId);
  try {
    const goal = await host.goalPort.readThreadGoal(threadId);
    if (goal === undefined || !goalCoordinator.readRevisionIsCurrent(threadId, readRevision)) return;
    applyThreadGoalIfActive(host, threadId, goal, { reportChange: false, panelTarget });
  } catch (error) {
    if (!goalCoordinator.readRevisionIsCurrent(threadId, readRevision)) return;
    addThreadGoalSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`, panelTarget);
  }
}

export function applyThreadGoalIfActive(
  host: ThreadGoalSyncHost,
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
  host: Pick<ThreadGoalSyncHost, "stateStore" | "addSystemMessage">,
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
