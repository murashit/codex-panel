import { type Thread, threadRecencyAt } from "../../domain/threads/model";
import {
  initialThreadRenameLifecycleState,
  type ThreadRenameLifecycleEvent as SharedThreadRenameLifecycleEvent,
  type ThreadRenameLifecycleState as SharedThreadRenameLifecycleState,
  type ThreadRenameActiveState,
  type ThreadRenameGeneratingState,
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
export type ThreadsGeneratingRenameState = ThreadRenameGeneratingState;
export type ThreadsRenameLifecycleState = ThreadsRenameState | undefined;
export type ThreadsRenameLifecycleEvent =
  | { type: "started"; draft: string }
  | { type: "draft-updated"; draft: string }
  | { type: "cancelled" }
  | { type: "auto-name-started"; generationToken: number }
  | { type: "auto-name-generated"; generatingState: ThreadsGeneratingRenameState; title: string }
  | { type: "auto-name-finished"; generatingState: ThreadsGeneratingRenameState };

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
  event: ThreadsRenameLifecycleEvent,
): ThreadsRenameLifecycleState {
  return activeThreadsRenameState(
    transitionThreadRenameLifecycleState(state ?? initialThreadRenameLifecycleState(), sharedThreadsRenameLifecycleEvent(event)),
  );
}

function sharedThreadsRenameLifecycleEvent(event: ThreadsRenameLifecycleEvent): SharedThreadRenameLifecycleEvent {
  switch (event.type) {
    case "started":
      return { type: "started", draft: event.draft };
    case "draft-updated":
      return { type: "draft-updated", draft: event.draft };
    case "cancelled":
      return { type: "cancelled" };
    case "auto-name-started":
      return { type: "generation-started", generationToken: event.generationToken };
    case "auto-name-generated":
      return { type: "generation-succeeded", generatingState: event.generatingState, draft: event.title };
    case "auto-name-finished":
      return { type: "generation-finished", generatingState: event.generatingState };
  }
}

function activeThreadsRenameState(state: SharedThreadRenameLifecycleState): ThreadsRenameLifecycleState {
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
