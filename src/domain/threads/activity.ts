export interface PanelThreadActivity {
  readonly threadId: string | null;
  readonly lastFocused: boolean;
  readonly pending: boolean;
  readonly turnBusy: boolean;
  readonly unread: boolean;
}

export interface ThreadListActivity {
  readonly panels: readonly PanelThreadActivity[];
  readonly archiveBlockedThreadIds: ReadonlySet<string>;
}

export type ObserveThreadListActivity = (changed: (activity: ThreadListActivity) => void) => () => void;

export function panelBlocksArchive(panel: PanelThreadActivity): boolean {
  return panel.pending || panel.turnBusy;
}

export function threadListActivity(panels: readonly PanelThreadActivity[], archiving: Iterable<string> = []): ThreadListActivity {
  const archiveBlockedThreadIds = new Set(archiving);
  for (const panel of panels) {
    if (panel.threadId && panelBlocksArchive(panel)) archiveBlockedThreadIds.add(panel.threadId);
  }
  return { panels, archiveBlockedThreadIds };
}

export const EMPTY_THREAD_ACTIVITY = threadListActivity([]);
