import type { Thread } from "../../domain/threads/model";
import type { OpenCodexPanelSnapshot } from "../../workspace/panel-coordinator";
import { hasPendingRequests, pendingRequestCounts } from "../../domain/pending-requests/aggregate";
import { threadRowCoreProjection, type ThreadRowCoreProjection } from "../threads/row-projection";
import {
  initialThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
  type ThreadRenameActiveState,
  type ThreadRenameGeneratingState,
  type ThreadRenameLifecycleEvent as SharedThreadRenameLifecycleEvent,
  type ThreadRenameLifecycleState as SharedThreadRenameLifecycleState,
} from "../threads/rename-lifecycle";

type ThreadsLiveStatus = "pending" | "running" | "open";

interface ThreadsLiveState {
  status: ThreadsLiveStatus;
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
  snapshots: OpenCodexPanelSnapshot[],
  renameStates: ReadonlyMap<string, ThreadsRenameState>,
  archiveConfirmThreadId: string | null = null,
  defaultArchiveSaveMarkdown = false,
): ThreadsRowModel[] {
  const snapshotsByThread = snapshotsForThreads(snapshots);
  return [...threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => {
      const threadSnapshots = snapshotsByThread.get(thread.id) ?? [];
      const live = liveStateForSnapshots(threadSnapshots);
      const selected = selectedStateForSnapshots(threadSnapshots);
      const core = threadRowCoreProjection({
        thread,
        selected,
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

function liveStateForSnapshots(snapshots: OpenCodexPanelSnapshot[]): ThreadsLiveState | null {
  const liveSnapshots = snapshots.filter((snapshot) => snapshot.threadId !== null);
  if (liveSnapshots.length === 0) return null;
  const winner = [...liveSnapshots].sort((a, b) => STATUS_PRIORITY[snapshotStatus(b)] - STATUS_PRIORITY[snapshotStatus(a)]).at(0);
  if (!winner) return null;
  const status = snapshotStatus(winner);
  return {
    status,
  };
}

function selectedStateForSnapshots(snapshots: OpenCodexPanelSnapshot[]): boolean {
  return snapshots.some((snapshot) => snapshot.threadId !== null && snapshot.lastFocused);
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

function snapshotsForThreads(snapshots: OpenCodexPanelSnapshot[]): Map<string, OpenCodexPanelSnapshot[]> {
  const map = new Map<string, OpenCodexPanelSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.threadId) continue;
    const existing = map.get(snapshot.threadId) ?? [];
    existing.push(snapshot);
    map.set(snapshot.threadId, existing);
  }
  return map;
}

function snapshotStatus(snapshot: OpenCodexPanelSnapshot): ThreadsLiveStatus {
  if (hasPendingRequests(pendingRequestCounts(snapshot))) return "pending";
  if (snapshot.turnLifecycle.kind !== "idle") return "running";
  return "open";
}
