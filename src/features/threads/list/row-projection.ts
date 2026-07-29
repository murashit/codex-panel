import type { Thread } from "../../../domain/threads/model";
import type { ThreadRenameActiveState } from "../../../domain/threads/rename-lifecycle";
import { threadDisplayTitle, threadRenameDraftTitle } from "../../../domain/threads/title";

interface ThreadRowCoreRenameProjection {
  readonly active: boolean;
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
  readonly rename: ThreadRowCoreRenameProjection;
  readonly archiveConfirm: ThreadRowCoreArchiveConfirmProjection;
}

export function threadRowCoreProjection(input: {
  readonly thread: Thread;
  readonly selected: boolean;
  readonly renameState?: ThreadRenameActiveState | undefined;
  readonly archiveConfirmActive?: boolean | undefined;
  readonly defaultArchiveSaveMarkdown?: boolean | undefined;
}): ThreadRowCoreProjection {
  const rename = input.renameState;
  return {
    threadId: input.thread.id,
    title: threadDisplayTitle(input.thread),
    selected: input.selected,
    isPinned: input.thread.isPinned === true,
    rename: {
      active: rename !== undefined,
      draft: rename?.draft ?? threadRenameDraftTitle(input.thread),
      generating: rename?.kind === "generating",
      saving: rename?.kind === "saving",
      autoNameDisabled: rename?.autoName.kind !== "ready",
    },
    archiveConfirm: {
      active: input.archiveConfirmActive ?? false,
      defaultSaveMarkdown: input.defaultArchiveSaveMarkdown ?? false,
    },
  };
}
