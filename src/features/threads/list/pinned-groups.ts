export interface PinnedThreadRow {
  readonly isPinned?: boolean;
}

export interface PinnedThreadGroups<Row extends PinnedThreadRow> {
  readonly pinned: readonly Row[];
  readonly unpinned: readonly Row[];
  readonly separated: boolean;
}

export function pinnedThreadGroups<Row extends PinnedThreadRow>(rows: readonly Row[]): PinnedThreadGroups<Row> {
  const pinned: Row[] = [];
  const unpinned: Row[] = [];
  for (const row of rows) {
    if (row.isPinned === true) pinned.push(row);
    else unpinned.push(row);
  }
  return {
    pinned,
    unpinned,
    separated: pinned.length > 0 && unpinned.length > 0,
  };
}
