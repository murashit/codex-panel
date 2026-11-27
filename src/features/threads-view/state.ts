import type { PanelThreadActivity, ThreadListActivity } from "../../domain/threads/activity";
import { compareThreadsPinnedFirst, type Thread } from "../../domain/threads/model";
import type { ThreadRenameActiveState } from "../../domain/threads/title";
import { type ThreadRowCoreProjection, threadRowCoreProjection } from "../threads/list/row-projection";

type ThreadsLiveStatus = "pending" | "running" | "unread" | "open";

export interface ThreadsRowModel extends ThreadRowCoreProjection {
  liveStatus: ThreadsLiveStatus | null;
}

export type ThreadsRenameState = ThreadRenameActiveState;

export function threadRows(
  threads: readonly Thread[],
  activity: ThreadListActivity,
  renameStates: ReadonlyMap<string, ThreadsRenameState>,
  archiveConfirmThreadId: string | null = null,
  defaultArchiveSaveMarkdown = false,
  visibleThreadId: (id: string | null) => string | null = (id) => id,
): ThreadsRowModel[] {
  const panelActivitiesByThread = new Map(activity.panels.map((panel) => [visibleThreadId(panel.threadId), panel]));
  return [...threads].sort(compareThreadsPinnedFirst).map((thread) => {
    const threadPanelActivity = panelActivitiesByThread.get(thread.id);
    return {
      ...threadRowCoreProjection({
        thread,
        selected: threadPanelActivity?.lastFocused ?? false,
        archiveBlockedThreadIds: activity.archiveBlockedThreadIds,
        renameState: renameStates.get(thread.id),
        archiveConfirmActive: archiveConfirmThreadId === thread.id,
        defaultArchiveSaveMarkdown,
      }),
      liveStatus: threadPanelActivity ? panelActivityStatus(threadPanelActivity) : null,
    };
  });
}

function panelActivityStatus(activity: PanelThreadActivity): ThreadsLiveStatus {
  if (activity.pending) return "pending";
  if (activity.turnBusy) return "running";
  if (activity.unread) return "unread";
  return "open";
}
