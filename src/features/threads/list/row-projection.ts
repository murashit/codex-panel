import type { Thread } from "../../../domain/threads/model";
import { type ThreadRenameActiveState, threadDisplayTitle } from "../../../domain/threads/title";

export interface ThreadRowRenameProjection {
  readonly draft: string;
  readonly generating: boolean;
  readonly saving: boolean;
  readonly autoNameDisabled: boolean;
}

interface ThreadRowCoreArchiveConfirmProjection {
  readonly active: boolean;
  readonly defaultSaveMarkdown: boolean;
}

export interface ThreadRowCoreProjection {
  readonly threadId: string;
  readonly title: string;
  readonly selected: boolean;
  readonly isPinned: boolean;
  readonly archiveDisabled: boolean;
  readonly rename: ThreadRowRenameProjection | null;
  readonly archiveConfirm: ThreadRowCoreArchiveConfirmProjection;
}

export function threadRowCoreProjection(input: {
  readonly thread: Thread;
  readonly archiveBlockedThreadIds: ReadonlySet<string>;
  readonly selected: boolean;
  readonly renameState: ThreadRenameActiveState | undefined;
  readonly archiveConfirmActive: boolean;
  readonly defaultArchiveSaveMarkdown: boolean;
}): ThreadRowCoreProjection {
  const rename = input.renameState;
  return {
    threadId: input.thread.id,
    archiveDisabled: input.archiveBlockedThreadIds.has(input.thread.id),
    title: threadDisplayTitle(input.thread),
    selected: input.selected,
    isPinned: input.thread.isPinned === true,
    rename: rename
      ? {
          draft: rename.draft,
          generating: rename.kind === "generating",
          saving: rename.kind === "saving",
          autoNameDisabled: rename.autoName.kind !== "ready",
        }
      : null,
    archiveConfirm: {
      active: input.archiveConfirmActive,
      defaultSaveMarkdown: input.defaultArchiveSaveMarkdown,
    },
  };
}
