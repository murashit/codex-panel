import type { Thread } from "../../domain/threads/model";
import { threadDisplayTitle, threadRenameDraftTitle } from "../../domain/threads/title";
import type { ThreadRenameActiveState } from "./rename-lifecycle";

interface ThreadRowCoreRenameProjection {
  readonly active: boolean;
  readonly draft: string;
  readonly generating: boolean;
}

interface ThreadRowCoreArchiveConfirmProjection {
  readonly active: boolean;
  readonly defaultSaveMarkdown: boolean;
}

export interface ThreadRowCoreProjection {
  readonly thread: Thread;
  readonly threadId: string;
  readonly title: string;
  readonly selected: boolean;
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
    thread: input.thread,
    threadId: input.thread.id,
    title: threadDisplayTitle(input.thread),
    selected: input.selected,
    rename: {
      active: rename !== undefined,
      draft: rename?.draft ?? threadRenameDraftTitle(input.thread),
      generating: rename?.kind === "generating",
    },
    archiveConfirm: {
      active: input.archiveConfirmActive ?? false,
      defaultSaveMarkdown: input.defaultArchiveSaveMarkdown ?? false,
    },
  };
}
