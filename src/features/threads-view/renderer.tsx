import type { ButtonHTMLAttributes, TargetedKeyboardEvent } from "preact";
import { useLayoutEffect, useRef, type ReactNode } from "preact/compat";

import { IconButton } from "../../shared/ui/react-components";
import { renderReactRoot, unmountReactRoot } from "../../shared/ui/react-root";
import type { ThreadsRowModel } from "./state";

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

export interface ThreadsViewModel {
  status: string | null;
  loading: boolean;
  rows: ThreadsRowModel[];
}

export interface ThreadsViewActions {
  refresh: () => void;
  openNewPanel: () => void;
  openThread: (threadId: string) => void;
  startRename: (threadId: string, value: string) => void;
  updateRename: (threadId: string, value: string) => void;
  saveRename: (threadId: string, value: string) => void;
  cancelRename: (threadId: string) => void;
  autoNameThread: (threadId: string) => void;
  startArchive: (threadId: string) => void;
  archiveThread: (threadId: string, saveMarkdown: boolean) => void;
}

export function renderThreadsView(parent: HTMLElement, model: ThreadsViewModel, actions: ThreadsViewActions): void {
  parent.addClass("codex-panel-threads");
  renderReactRoot(parent, <ThreadsView model={model} actions={actions} />);
}

export function unmountThreadsView(parent: HTMLElement | null): void {
  unmountReactRoot(parent);
}

function ThreadsView({ model, actions }: { model: ThreadsViewModel; actions: ThreadsViewActions }): ReactNode {
  return (
    <>
      <div className="nav-header codex-panel-threads__toolbar">
        <div className="nav-buttons-container codex-panel-threads__toolbar-actions">
          <ThreadsIconButton
            icon="message-square-plus"
            label="Open new panel"
            className="codex-panel-threads__toolbar-button"
            onClick={actions.openNewPanel}
          />
          <ThreadsIconButton
            icon="refresh-cw"
            label="Refresh threads"
            className="codex-panel-threads__toolbar-button"
            onClick={actions.refresh}
          />
        </div>
      </div>
      <div className="codex-panel-threads__list" role="list">
        {model.rows.length === 0 ? (
          <div className="codex-panel-threads__empty">{model.status ?? (model.loading ? "Loading threads..." : "No threads")}</div>
        ) : (
          <>
            {model.status ? <div className="codex-panel-threads__status">{model.status}</div> : null}
            {model.rows.map((row) => (
              <ThreadRow key={row.thread.id} row={row} actions={actions} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function ThreadRow({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewActions }): ReactNode {
  const archiveConfirm = archiveConfirmState(row);
  const className = [
    "codex-panel-threads__row",
    row.live ? `codex-panel-threads__row--${row.live.status}` : "",
    row.rename.active ? "codex-panel-threads__row--renaming" : "",
    archiveConfirm.active ? "codex-panel-threads__row--archive-confirming" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const open = () => {
    if (row.rename.active || archiveConfirm.active) return;
    actions.openThread(row.thread.id);
  };
  const openFromKeyboard = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (row.rename.active || archiveConfirm.active) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    actions.openThread(row.thread.id);
  };

  return (
    <div className={className} role="button" tabIndex={0} onClick={open} onKeyDown={openFromKeyboard}>
      {row.rename.active ? (
        <RenameRow row={row} actions={actions} />
      ) : (
        <>
          <div className="codex-panel-threads__row-title-line">
            <span className="codex-panel-threads__row-title">{row.title}</span>
          </div>
          <div
            className={["codex-panel-threads__actions", archiveConfirm.active ? "codex-panel-threads__archive-confirm" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {!archiveConfirm.active ? (
              <ThreadsIconButton
                icon="pencil"
                label="Rename thread"
                className="codex-panel-threads__row-button"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.startRename(row.thread.id, row.thread.name ?? row.title);
                }}
              />
            ) : null}
            <ArchiveActions row={row} actions={actions} />
          </div>
        </>
      )}
    </div>
  );
}

function ArchiveActions({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewActions }): ReactNode {
  const archiveConfirm = archiveConfirmState(row);
  if (!archiveConfirm.active) {
    return (
      <ThreadsIconButton
        icon="archive"
        label="Archive thread"
        className="codex-panel-threads__row-button"
        onClick={(event) => {
          event.stopPropagation();
          actions.startArchive(row.thread.id);
        }}
      />
    );
  }

  const defaultSaveMarkdown = archiveConfirm.defaultSaveMarkdown;
  return (
    <>
      <ArchiveModeButton row={row} saveMarkdown={!defaultSaveMarkdown} primary={false} actions={actions} />
      <ArchiveModeButton row={row} saveMarkdown={defaultSaveMarkdown} primary={true} actions={actions} />
    </>
  );
}

function ArchiveModeButton({
  row,
  saveMarkdown,
  primary,
  actions,
}: {
  row: ThreadsRowModel;
  saveMarkdown: boolean;
  primary: boolean;
  actions: ThreadsViewActions;
}): ReactNode {
  const label = saveMarkdown ? "Save and archive thread" : "Archive thread without saving";
  return (
    <ThreadsIconButton
      icon={saveMarkdown ? "save" : "trash"}
      label={label}
      className={primary ? "codex-panel-threads__archive-default" : "codex-panel-threads__archive-alternate"}
      onClick={(event) => {
        event.stopPropagation();
        actions.archiveThread(row.thread.id, saveMarkdown);
      }}
    />
  );
}

function RenameRow({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewActions }): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.ownerDocument.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, [row.rename.draft]);

  return (
    <>
      <div
        className="codex-panel-threads__rename-form"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="codex-panel-threads__rename-field">
          <input
            ref={inputRef}
            className="codex-panel-threads__rename-input"
            type="text"
            aria-label="Thread name"
            value={row.rename.draft}
            onChange={(event) => {
              actions.updateRename(row.thread.id, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!event.isComposing && !row.rename.generating) actions.saveRename(row.thread.id, event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                actions.cancelRename(row.thread.id);
              }
            }}
            onBlur={(event) => {
              if (!row.rename.generating) actions.saveRename(row.thread.id, event.currentTarget.value);
            }}
          />
        </div>
      </div>
      <div className="codex-panel-threads__actions codex-panel-threads__rename-actions">
        <ThreadsIconButton
          icon={row.rename.generating ? "loader" : "sparkles"}
          label="Auto-name thread"
          className="codex-panel-threads__row-button"
          disabled={row.rename.generating}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            actions.autoNameThread(row.thread.id);
          }}
        />
      </div>
    </>
  );
}

function ThreadsIconButton({
  icon,
  label,
  className,
  ...props
}: {
  icon: string;
  label: string;
  className: string;
} & Omit<ButtonProps, "className" | "type">): ReactNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={`clickable-icon nav-action-button codex-panel-threads__icon-button ${className}`}
    />
  );
}

function archiveConfirmState(row: ThreadsRowModel): { active: boolean; defaultSaveMarkdown: boolean } {
  return row.archiveConfirm ?? { active: false, defaultSaveMarkdown: false };
}
