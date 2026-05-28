import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import type { Thread } from "../../generated/app-server/v2/Thread";
import { getThreadTitle } from "../../domain/threads/model";

export type ThreadsLiveStatus = "needs-input" | "approval" | "running" | "draft" | "offline" | "open";

export interface ThreadsLiveState {
  status: ThreadsLiveStatus;
  label: string;
  viewId: string;
  openPanels: number;
}

export interface ThreadsRowModel {
  thread: Thread;
  title: string;
  live: ThreadsLiveState | null;
  rename: { active: boolean; draft: string; generating: boolean };
  archiveConfirm?: { active: boolean; defaultSaveMarkdown: boolean };
}

export type ThreadsRenameState = { kind: "editing"; draft: string } | { kind: "generating"; draft: string; originalDraft: string };

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
      const live = liveStateForSnapshots(snapshotsByThread.get(thread.id) ?? []);
      const rename = renameStates.get(thread.id);
      return {
        thread,
        title: getThreadTitle(thread),
        live,
        rename: {
          active: rename !== undefined,
          draft: rename?.draft ?? thread.name ?? getThreadTitle(thread),
          generating: rename?.kind === "generating",
        },
        archiveConfirm: {
          active: archiveConfirmThreadId === thread.id,
          defaultSaveMarkdown: defaultArchiveSaveMarkdown,
        },
      };
    });
}

export function liveStateForSnapshots(snapshots: OpenCodexPanelSnapshot[]): ThreadsLiveState | null {
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
  if (snapshot.pendingUserInputs > 0) return "needs-input";
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
