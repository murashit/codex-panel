import type { Thread } from "../../domain/threads/model";
import { threadRenameDraftTitle, threadUserTitle } from "../../domain/threads/title";
import type { OpenCodexPanelSnapshot } from "../../workspace/panel-coordinator";
import {
  initialThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
  type ThreadRenameActiveState,
  type ThreadRenameGeneratingState,
  type ThreadRenameLifecycleEvent as SharedThreadRenameLifecycleEvent,
  type ThreadRenameLifecycleState as SharedThreadRenameLifecycleState,
} from "../threads/rename-lifecycle";

type ThreadsLiveStatus = "needs-input" | "approval" | "running" | "draft" | "offline" | "open";

interface ThreadsLiveState {
  status: ThreadsLiveStatus;
  label: string;
  viewId: string;
  openPanels: number;
}

export interface ThreadsRowModel {
  thread: Thread;
  title: string;
  live: ThreadsLiveState | null;
  selected: boolean;
  rename: { active: boolean; draft: string; generating: boolean };
  archiveConfirm: { active: boolean; defaultSaveMarkdown: boolean };
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
  "needs-input": 5,
  approval: 4,
  running: 3,
  draft: 2,
  offline: 1,
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
      const rename = renameStates.get(thread.id);
      return {
        thread,
        title: threadUserTitle(thread),
        live,
        selected,
        rename: {
          active: rename !== undefined,
          draft: rename?.draft ?? threadRenameDraftTitle(thread),
          generating: rename?.kind === "generating",
        },
        archiveConfirm: {
          active: archiveConfirmThreadId === thread.id,
          defaultSaveMarkdown: defaultArchiveSaveMarkdown,
        },
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
    label: statusLabel(status),
    viewId: winner.viewId,
    openPanels: liveSnapshots.length,
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
  if (snapshot.pendingUserInputs > 0 || snapshot.pendingMcpElicitations > 0) return "needs-input";
  if (snapshot.pendingApprovals > 0) return "approval";
  if (snapshot.turnLifecycle.kind !== "idle") return "running";
  if (snapshot.hasComposerDraft) return "draft";
  if (!snapshot.connected) return "offline";
  return "open";
}

function statusLabel(status: ThreadsLiveStatus): string {
  switch (status) {
    case "needs-input":
      return "Needs input";
    case "approval":
      return "Approval";
    case "running":
      return "Running";
    case "draft":
      return "Draft";
    case "offline":
      return "Offline";
    case "open":
      return "Open";
  }
}
