import type { ComponentChild as UiNode } from "preact";
import { Icon, IconButton } from "../../../../shared/ui/icon.dom";
import { ThreadActionControls, ThreadAutoNameButton, ThreadRenameInput } from "../../../threads/ui/thread-controls.dom";
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
  return (
    <div
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
      {thread?.rename && actions ? (
        <ThreadRenameInput
          className="codex-panel__conversation-rename-input"
          value={thread.rename.draft}
          busy={thread.rename.generating || thread.rename.saving}
          onUpdate={(value) => {
            actions.rename.updateDraft(thread.threadId, value);
          }}
          onSave={(value) => {
            actions.rename.save(thread.threadId, value);
          }}
          onCancel={() => {
            actions.rename.cancel(thread.threadId);
          }}
        />
      ) : (
        <span className="codex-panel__conversation-title">{title}</span>
      )}
      {thread && actions ? (
        thread.rename ? (
          <ThreadAutoNameButton
            className="codex-panel__conversation-action"
            generating={thread.rename.generating}
            saving={thread.rename.saving}
            autoNameDisabled={thread.rename.autoNameDisabled}
            onStart={() => {
              actions.rename.autoName(thread.threadId);
            }}
            onCancel={() => {
              actions.rename.cancelAutoName(thread.threadId);
            }}
          />
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
