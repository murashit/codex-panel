import type { ButtonHTMLAttributes, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { IconButton, ObsidianToolbarAction, type ObsidianToolbarActionProps } from "../../shared/ui/components.obsidian";
import { renderUiRoot, unmountUiRoot } from "../../shared/ui/ui-root.dom";
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
  renderUiRoot(parent, <ThreadsView model={model} actions={actions} />);
}

export function unmountThreadsView(parent: HTMLElement | null): void {
  unmountUiRoot(parent);
}

function ThreadsView({ model, actions }: { model: ThreadsViewModel; actions: ThreadsViewActions }): UiNode {
  return (
    <>
      <div className="nav-header codex-panel-threads__toolbar">
        <div className="nav-buttons-container codex-panel-threads__toolbar-actions">
          <ThreadsToolbarButton icon="message-square-plus" label="Open new panel" onClick={actions.openNewPanel} />
          <ThreadsToolbarButton icon="refresh-cw" label="Refresh threads" onClick={actions.refresh} />
        </div>
      </div>
      <div className="codex-panel-threads__list">
        {model.rows.length === 0 ? (
          <div className="codex-panel-threads__empty">{model.status ?? (model.loading ? "Loading threads..." : "No threads")}</div>
        ) : (
          <>
            {model.status ? <div className="codex-panel-threads__status">{model.status}</div> : null}
            {model.rows.map((row) => (
              <ThreadRow key={row.threadId} row={row} actions={actions} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function ThreadRow({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewActions }): UiNode {
  const archiveConfirm = row.archiveConfirm;
  const rowClassName = [
    "codex-panel-ui__nav-row",
    "codex-panel-threads__row",
    row.selected ? "codex-panel-threads__row--selected" : "",
    row.selected ? "is-selected" : "",
    row.rename.active ? "codex-panel-threads__row--renaming" : "",
    archiveConfirm.active ? "codex-panel-threads__row--archive-confirming" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mainClassName = [
    "codex-panel-ui__nav-item",
    "codex-panel-threads__row-main",
    row.live ? liveStatusClassName(row.live.status) : "",
    row.selected ? "codex-panel-threads__row--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const open = () => {
    if (row.rename.active || archiveConfirm.active) return;
    actions.openThread(row.threadId);
  };
  return (
    <div className={rowClassName}>
      {row.rename.active ? (
        <RenameRow row={row} actions={actions} className={mainClassName} />
      ) : (
        <>
          {/* biome-ignore lint/a11y: Thread rows intentionally follow Obsidian's native file explorer nav rows: pointer-first div items with selection represented by classes, while row actions stay as real icon buttons. */}
          <div className={mainClassName} onClick={open}>
            <span className="codex-panel-threads__row-title">{row.title}</span>
          </div>
          <div
            className={["codex-panel-threads__actions", archiveConfirm.active ? "codex-panel-threads__archive-confirm" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {!archiveConfirm.active ? (
              <ThreadsRowButton
                icon="pencil"
                label="Rename thread"
                className="codex-panel-threads__row-button"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.startRename(row.threadId, row.rename.draft);
                }}
              />
            ) : null}
            <ArchiveActions row={row} archiveConfirm={archiveConfirm} actions={actions} />
          </div>
        </>
      )}
    </div>
  );
}

function ArchiveActions({
  row,
  archiveConfirm,
  actions,
}: {
  row: ThreadsRowModel;
  archiveConfirm: ThreadsRowModel["archiveConfirm"];
  actions: ThreadsViewActions;
}): UiNode {
  if (!archiveConfirm.active) {
    return (
      <ThreadsRowButton
        icon="archive"
        label="Archive thread"
        className="codex-panel-threads__row-button"
        onClick={(event) => {
          event.stopPropagation();
          actions.startArchive(row.threadId);
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
}): UiNode {
  const label = saveMarkdown ? "Save and archive thread" : "Archive thread without saving";
  return (
    <ThreadsRowButton
      icon={saveMarkdown ? "save" : "trash"}
      label={label}
      className={primary ? "codex-panel-threads__archive-default" : "codex-panel-threads__archive-alternate"}
      onClick={(event) => {
        event.stopPropagation();
        actions.archiveThread(row.threadId, saveMarkdown);
      }}
    />
  );
}

function RenameRow({ row, actions, className }: { row: ThreadsRowModel; actions: ThreadsViewActions; className: string }): UiNode {
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
      <div className={`${className} codex-panel-threads__rename-form`}>
        <div className="codex-panel-threads__rename-field">
          <input
            ref={inputRef}
            className="codex-panel-ui__nav-inline-input codex-panel-threads__rename-input"
            type="text"
            value={row.rename.draft}
            onInput={(event) => {
              actions.updateRename(row.threadId, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!event.isComposing && !row.rename.generating) actions.saveRename(row.threadId, event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                actions.cancelRename(row.threadId);
              }
            }}
            onBlur={(event) => {
              if (!row.rename.generating) actions.saveRename(row.threadId, event.currentTarget.value);
            }}
          />
        </div>
      </div>
      <div className="codex-panel-threads__actions codex-panel-threads__rename-actions">
        <ThreadsRowButton
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
            actions.autoNameThread(row.threadId);
          }}
        />
      </div>
    </>
  );
}

function liveStatusClassName(status: NonNullable<ThreadsRowModel["live"]>["status"]): string {
  if (status === "open") return "codex-panel-threads__row--open";
  if (status === "pending") return "codex-panel-threads__row--pending";
  return "codex-panel-threads__row--running";
}

function ThreadsToolbarButton({
  icon,
  label,
  ...props
}: {
  icon: string;
  label: string;
} & Omit<ObsidianToolbarActionProps, "className" | "icon" | "label">): UiNode {
  return (
    <ObsidianToolbarAction
      {...props}
      icon={icon}
      label={label}
      className="clickable-icon nav-action-button codex-panel-ui__toolbar-action codex-panel-threads__toolbar-button"
    />
  );
}

function ThreadsRowButton({
  icon,
  label,
  className,
  ...props
}: {
  icon: string;
  label: string;
  className: string;
} & Omit<ButtonProps, "className" | "type">): UiNode {
  return <IconButton {...props} icon={icon} label={label} className={`clickable-icon codex-panel-ui__nav-row-action ${className}`} />;
}
