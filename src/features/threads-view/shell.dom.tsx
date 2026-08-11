import type { ButtonHTMLAttributes, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { renderObsidianUiRoot } from "../../shared/obsidian/preact-root.obsidian";
import { IconButton, ToolbarIconAction, type ToolbarIconActionProps } from "../../shared/ui/icon.dom";
import { pinnedThreadGroups } from "../threads/list/pinned-groups";
import type { ThreadsRowModel } from "./state";

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

export interface ThreadsViewShellModel {
  status: { kind: "loading" | "error"; message: string } | null;
  loading: boolean;
  fetching?: boolean;
  hasMore?: boolean;
  rows: ThreadsRowModel[];
}

export interface ThreadsViewShellActions {
  refresh: () => void;
  loadMore: () => void;
  openNewPanel: () => void;
  openThread: (threadId: string) => void;
  startRename: (threadId: string, value: string) => void;
  updateRename: (threadId: string, value: string) => void;
  saveRename: (threadId: string, value: string) => void;
  cancelRename: (threadId: string) => void;
  cancelAutoName: (threadId: string) => void;
  autoNameThread: (threadId: string) => void;
  setThreadPinned: (threadId: string, isPinned: boolean) => void;
  startArchive: (threadId: string) => void;
  archiveThread: (threadId: string, saveMarkdown: boolean) => void;
}

export function renderThreadsViewShell(parent: HTMLElement, model: ThreadsViewShellModel, actions: ThreadsViewShellActions): void {
  parent.addClass("codex-panel-threads");
  renderObsidianUiRoot(parent, <ThreadsViewShell model={model} actions={actions} />);
}

export function unmountThreadsViewShell(parent: HTMLElement | null): void {
  unmountUiRoot(parent);
}

export function isThreadsArchiveConfirmPointer(event: PointerEvent, root: HTMLElement, viewWindow: Window): boolean {
  const target = event.target;
  const domWindow = viewWindow as Window & { Element: typeof Element };
  if (!(target instanceof domWindow.Element)) return false;
  const archiveConfirm = target.closest(".codex-panel-threads__archive-confirm");
  return Boolean(archiveConfirm && root.contains(archiveConfirm));
}

function focusThreadsRenameInput(input: HTMLInputElement | null): void {
  if (!input) return;
  if (input.ownerDocument.activeElement === input) return;
  input.focus();
  input.select();
}

function ThreadsViewShell({ model, actions }: { model: ThreadsViewShellModel; actions: ThreadsViewShellActions }): UiNode {
  const groups = pinnedThreadGroups(model.rows);
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
          <ThreadsViewState status={model.status} />
        ) : (
          <>
            {groups.separated ? (
              <>
                {groups.pinned.map((row) => (
                  <ThreadRow key={row.threadId} row={row} actions={actions} />
                ))}
                <hr className="codex-panel-threads__group-divider" />
                {groups.unpinned.map((row) => (
                  <ThreadRow key={row.threadId} row={row} actions={actions} />
                ))}
              </>
            ) : (
              model.rows.map((row) => <ThreadRow key={row.threadId} row={row} actions={actions} />)
            )}
            {model.hasMore ? (
              <button
                type="button"
                className="codex-panel-ui__nav-item codex-panel-threads__load-more"
                disabled={model.fetching ?? model.loading}
                onClick={actions.loadMore}
              >
                {model.loading ? "Loading..." : "Load more threads"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function ThreadsViewState({ status }: { status: ThreadsViewShellModel["status"] }): UiNode {
  const className = ["codex-panel-threads__state", status ? "codex-panel-threads__status" : "codex-panel-threads__empty"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} role={status ? "status" : undefined}>
      {status?.message ?? "No threads"}
    </div>
  );
}

function ThreadRow({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewShellActions }): UiNode {
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
            <ArchiveControls row={row} archiveConfirm={archiveConfirm} actions={actions} />
            {!archiveConfirm.active ? <PinThreadButton row={row} actions={actions} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function PinThreadButton({ row, actions }: { row: ThreadsRowModel; actions: ThreadsViewShellActions }): UiNode {
  return (
    <ThreadsRowButton
      icon="star"
      label={row.isPinned ? "Unpin thread" : "Pin thread"}
      className={[
        "codex-panel-threads__row-button",
        "codex-panel-threads__pin-button",
        row.isPinned ? "codex-panel-threads__pin-button--pinned" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={row.isPinned}
      onClick={(event) => {
        event.stopPropagation();
        actions.setThreadPinned(row.threadId, !row.isPinned);
      }}
    />
  );
}

function ArchiveControls({
  row,
  archiveConfirm,
  actions,
}: {
  row: ThreadsRowModel;
  archiveConfirm: ThreadsRowModel["archiveConfirm"];
  actions: ThreadsViewShellActions;
}): UiNode {
  if (!archiveConfirm.active) {
    return (
      <ThreadsRowButton
        icon="archive"
        label="Archive thread"
        className="codex-panel-threads__row-button"
        disabled={threadArchiveDisabled(row)}
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
      <ArchiveModeButton row={row} saveMarkdown={defaultSaveMarkdown} primary={true} actions={actions} />
      <ArchiveModeButton row={row} saveMarkdown={!defaultSaveMarkdown} primary={false} actions={actions} />
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
  actions: ThreadsViewShellActions;
}): UiNode {
  const label = saveMarkdown ? "Save and archive thread" : "Archive thread without saving";
  return (
    <ThreadsRowButton
      icon={saveMarkdown ? "save" : "trash"}
      label={label}
      className={primary ? "codex-panel-threads__archive-default" : "codex-panel-threads__archive-alternate"}
      disabled={threadArchiveDisabled(row)}
      onClick={(event) => {
        event.stopPropagation();
        actions.archiveThread(row.threadId, saveMarkdown);
      }}
    />
  );
}

function threadArchiveDisabled(row: ThreadsRowModel): boolean {
  return row.lifecycleBusy || row.live?.status === "pending" || row.live?.status === "running";
}

function RenameRow({ row, actions, className }: { row: ThreadsRowModel; actions: ThreadsViewShellActions; className: string }): UiNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameBusy = row.rename.generating || row.rename.saving;
  useLayoutEffect(() => {
    if (!renameBusy) focusThreadsRenameInput(inputRef.current);
  }, [row.rename.draft, renameBusy]);

  return (
    <>
      <div className={`${className} codex-panel-threads__rename-form`}>
        <div className="codex-panel-threads__rename-field">
          <input
            ref={inputRef}
            className="codex-panel-ui__nav-inline-input codex-panel-threads__rename-input"
            type="text"
            value={row.rename.draft}
            disabled={renameBusy}
            onInput={(event) => {
              actions.updateRename(row.threadId, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!event.isComposing && !renameBusy) actions.saveRename(row.threadId, event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                if (!renameBusy) actions.cancelRename(row.threadId);
              }
            }}
            onBlur={(event) => {
              if (!renameBusy) actions.saveRename(row.threadId, event.currentTarget.value);
            }}
          />
        </div>
      </div>
      <div className="codex-panel-threads__actions codex-panel-threads__rename-actions">
        <ThreadsRowButton
          icon={row.rename.generating ? "x" : "sparkles"}
          label={row.rename.generating ? "Cancel auto-name" : "Auto-name thread"}
          className="codex-panel-threads__row-button"
          disabled={row.rename.saving || (!row.rename.generating && row.rename.autoNameDisabled)}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (row.rename.generating) actions.cancelAutoName(row.threadId);
            else actions.autoNameThread(row.threadId);
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
} & Omit<ToolbarIconActionProps, "className" | "icon" | "label">): UiNode {
  return (
    <ToolbarIconAction
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
