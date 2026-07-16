import { type Thread, threadRecencyAt } from "../../domain/threads/model";
import {
  initialThreadRenameLifecycleState,
  type ThreadRenameActiveState,
  type ThreadRenameLifecycleEvent,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../domain/threads/rename-lifecycle";
import { type ThreadRowCoreProjection, threadRowCoreProjection } from "../threads/list/row-projection";

type ThreadsLiveStatus = "pending" | "running" | "open";

interface ThreadsLiveState {
  status: ThreadsLiveStatus;
}

export interface ThreadsViewPanelActivity {
  threadId: string | null;
  selected: boolean;
  pending: boolean;
  running: boolean;
}

export interface ThreadsRowModel extends ThreadRowCoreProjection {
  live: ThreadsLiveState | null;
}

export type ThreadsRenameState = ThreadRenameActiveState;
export type ThreadsRenameLifecycleState = ThreadsRenameState | undefined;

const STATUS_PRIORITY: Record<ThreadsLiveStatus, number> = {
  pending: 2,
  running: 1,
  open: 0,
};

export function threadRows(
  threads: readonly Thread[],
  panelActivities: readonly ThreadsViewPanelActivity[],
  renameStates: ReadonlyMap<string, ThreadsRenameState>,
  archiveConfirmThreadId: string | null = null,
  defaultArchiveSaveMarkdown = false,
): ThreadsRowModel[] {
  const panelActivitiesByThread = panelActivitiesForThreads(panelActivities);
  return [...threads]
    .sort((a, b) => threadRecencyAt(b) - threadRecencyAt(a))
    .map((thread) => {
      const threadPanelActivities = panelActivitiesByThread.get(thread.id) ?? [];
      const live = liveStateForPanelActivities(threadPanelActivities);
      const core = threadRowCoreProjection({
        thread,
        selected: threadPanelActivities.some((activity) => activity.threadId !== null && activity.selected),
        renameState: renameStates.get(thread.id),
        archiveConfirmActive: archiveConfirmThreadId === thread.id,
        defaultArchiveSaveMarkdown,
      });
      return {
        ...core,
        live,
      };
    });
}

function liveStateForPanelActivities(panelActivities: ThreadsViewPanelActivity[]): ThreadsLiveState | null {
  const livePanelActivities = panelActivities.filter((activity) => activity.threadId !== null);
  if (livePanelActivities.length === 0) return null;
  const winner = [...livePanelActivities]
    .sort((a, b) => STATUS_PRIORITY[panelActivityStatus(b)] - STATUS_PRIORITY[panelActivityStatus(a)])
    .at(0);
  if (!winner) return null;
  const status = panelActivityStatus(winner);
  return {
    status,
  };
}

export function transitionThreadsRenameState(
  state: ThreadsRenameLifecycleState,
  event: ThreadRenameLifecycleEvent,
): ThreadsRenameLifecycleState {
  return activeThreadsRenameState(transitionThreadRenameLifecycleState(state ?? initialThreadRenameLifecycleState(), event));
}

function activeThreadsRenameState(state: ThreadRenameLifecycleState): ThreadsRenameLifecycleState {
  return state.kind === "idle" ? undefined : state;
}

function panelActivitiesForThreads(panelActivities: readonly ThreadsViewPanelActivity[]): Map<string, ThreadsViewPanelActivity[]> {
  const map = new Map<string, ThreadsViewPanelActivity[]>();
  for (const activity of panelActivities) {
    if (!activity.threadId) continue;
    const existing = map.get(activity.threadId) ?? [];
    existing.push(activity);
    map.set(activity.threadId, existing);
  }
  return map;
}

function panelActivityStatus(activity: ThreadsViewPanelActivity): ThreadsLiveStatus {
  if (activity.pending) return "pending";
  if (activity.running) return "running";
  return "open";
}
