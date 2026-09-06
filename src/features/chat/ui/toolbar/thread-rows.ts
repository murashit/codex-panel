import { compareThreadsPinnedFirst, type Thread } from "../../../../domain/threads/model";
import type { ThreadRenameActiveState } from "../../../../domain/threads/rename-lifecycle";
import { threadRowCoreProjection } from "../../../threads/list/row-projection";
import type { ToolbarThreadRow } from "./model";

export function toolbarThreadRows(input: {
  threads: readonly Thread[];
  archiveBlockedThreadId: string | null;
  selectedRowId: string | null;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: (ThreadRenameActiveState & { readonly threadId: string }) | null;
}): ToolbarThreadRow[] {
  return [...input.threads].sort(compareThreadsPinnedFirst).map((thread) => {
    const threadId = thread.id;
    const core = threadRowCoreProjection({
      thread,
      selected: threadId === input.selectedRowId,
      renameState: input.renameState?.threadId === threadId ? input.renameState : undefined,
      archiveConfirmActive: input.archiveConfirmThreadId === threadId,
      defaultArchiveSaveMarkdown: input.archiveExportEnabled,
    });
    return {
      ...core,
      renameDisabled: input.renameState?.kind === "saving",
      archiveDisabled: threadId === input.archiveBlockedThreadId,
      rename: core.rename.active
        ? {
            draft: core.rename.draft,
            generating: core.rename.generating,
            saving: core.rename.saving,
            autoNameDisabled: core.rename.autoNameDisabled,
          }
        : null,
    };
  });
}
