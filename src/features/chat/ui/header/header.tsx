import type { ComponentChild as UiNode } from "preact";
import { Icon, IconButton } from "../../../../shared/ui/icon.dom";
import { ThreadActionControls, threadRenameControls } from "../../../threads/ui/thread-controls.dom";
import type { ToolbarThreadRow } from "../toolbar/model";
import type { ToolbarThreadActions } from "../toolbar/toolbar";

export interface ConversationHeaderProps {
  title: string;
  thread?: Pick<ToolbarThreadRow, "threadId" | "renameDisabled" | "archiveDisabled" | "archiveConfirm" | "rename"> | undefined;
  actions?: Pick<ToolbarThreadActions, "rename" | "archive"> | undefined;
  persistence:
    | { kind: "selectable"; ephemeral: boolean; disabled: boolean; onToggle: () => void }
    | { kind: "fixed"; ephemeral: boolean }
    | null;
}

export function ConversationHeader({ title, persistence, thread, actions }: ConversationHeaderProps): UiNode {
  const icon = persistence?.ephemeral ? "message-square-dashed" : "message-square";
  const rename =
    thread?.rename && actions
      ? threadRenameControls({
          state: thread.rename,
          classNames: { input: "codex-panel__conversation-rename-input", action: "codex-panel__conversation-action" },
          threadId: thread.threadId,
          actions: actions.rename,
        })
      : null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The header delegates bubbled Escape from native rename controls; it is not a separate keyboard target.
    <div
      onFocusOut={rename?.onFocusOut}
      onKeyDown={rename?.onKeyDown}
      className={`codex-panel__conversation-header${thread?.archiveConfirm.active ? " codex-panel__archive-confirm codex-panel__conversation-header--confirming" : ""}`}
    >
      {persistence?.kind === "selectable" ? (
        <IconButton
          icon={icon}
          label={persistence.ephemeral ? "Use regular conversation" : "Use temporary conversation"}
          className="clickable-icon codex-panel-ui__nav-row-action codex-panel__conversation-persistence codex-panel__conversation-toggle"
          disabled={persistence.disabled}
          onClick={persistence.onToggle}
        />
      ) : persistence ? (
        <span
          className="codex-panel-ui__nav-row-action codex-panel__conversation-persistence"
          role="img"
          aria-label={persistence.ephemeral ? "Temporary conversation" : "Regular conversation"}
        >
          <Icon icon={icon} />
        </span>
      ) : (
        <span className="codex-panel-ui__nav-row-action codex-panel__conversation-persistence" aria-hidden="true" />
      )}
      {rename ? rename.input : <span className="codex-panel__conversation-title">{title}</span>}
      {thread && actions ? (
        rename ? (
          rename.action
        ) : (
          <div className="codex-panel__conversation-actions">
            <ThreadActionControls
              renameDisabled={thread.renameDisabled}
              archiveDisabled={thread.archiveDisabled}
              manageArchiveFocus
              archiveConfirm={thread.archiveConfirm}
              classNames={{
                action: "codex-panel__conversation-action",
                archivePrimary: "codex-panel__conversation-action codex-panel__archive-default",
                archiveAlternate: "codex-panel__conversation-action codex-panel__archive-alternate",
              }}
              onRename={() => {
                actions.rename.start(thread.threadId);
              }}
              onArchiveStart={() => {
                actions.archive.start(thread.threadId);
              }}
              onArchiveConfirm={(save) => {
                actions.archive.confirm(thread.threadId, save);
              }}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
