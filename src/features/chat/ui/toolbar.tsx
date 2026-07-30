import type { ButtonHTMLAttributes, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { IconButton, ObsidianToolbarAction, type ObsidianToolbarActionProps } from "../../../shared/obsidian/components.obsidian";
import { pinnedThreadGroups } from "../../threads/list/pinned-groups";
import { focusToolbarRenameInput } from "./toolbar.dom";
import type { RateLimitSummary, ToolbarStatusRow, ToolbarStatusSection, ToolbarThreadRow, ToolbarViewModel } from "./toolbar-model";

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

interface ToolbarPrimaryActions {
  toggleHistory: () => void;
  toggleChatActions: () => void;
  toggleStatusPanel: () => void;
}

interface ToolbarChatActions {
  startNewThread: () => void;
  startSideChat: () => void;
  compactContext: () => void;
  setGoal: () => void;
}

interface ToolbarStatusActions {
  connect: () => void;
  refreshStatus: () => void;
  copyDebugDetails: () => void;
}

interface ToolbarThreadActions {
  loadMore: () => void;
  resume: (threadId: string) => void;
  setPinned: (threadId: string, isPinned: boolean) => void;
  archive: {
    start: (threadId: string) => void;
    confirm: (threadId: string, saveMarkdown: boolean) => void;
  };
  rename: {
    start: (threadId: string) => void;
    updateDraft: (threadId: string, value: string) => void;
    save: (threadId: string, value: string) => void;
    cancel: (threadId: string) => void;
    cancelAutoName: (threadId: string) => void;
    autoName: (threadId: string) => void;
  };
}

export interface ToolbarActions {
  primary: ToolbarPrimaryActions;
  chat: ToolbarChatActions;
  status: ToolbarStatusActions;
  threads: ToolbarThreadActions;
}

export function Toolbar({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  const historyOpen = model.openPanel === "history";
  const chatActionsOpen = model.openPanel === "chat-actions";
  return (
    <>
      <div className="nav-header codex-panel__toolbar-primary">
        <div className="nav-buttons-container codex-panel__toolbar-buttons">
          <ToolbarIconButton
            icon="history"
            label={historyOpen ? "Hide thread list" : "Show thread list"}
            className={["codex-panel__history-toggle", historyOpen ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={actions.primary.toggleHistory}
          />
          <ToolbarIconButton
            icon="messages-square"
            label={chatActionsOpen ? "Hide chat actions" : "Show chat actions"}
            className={["codex-panel__new-chat", chatActionsOpen ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={actions.primary.toggleChatActions}
          />
          <StatusButton model={model} actions={actions.primary} />
        </div>
      </div>
      <ToolbarPanel model={model} actions={actions} />
    </>
  );
}

function ToolbarIconButton({
  icon,
  label,
  className,
  ...props
}: {
  icon: string;
  label: string;
  className?: string;
} & Omit<ObsidianToolbarActionProps, "className" | "icon" | "label">): UiNode {
  return (
    <ObsidianToolbarAction
      {...props}
      icon={icon}
      label={label}
      className={["clickable-icon nav-action-button codex-panel-ui__toolbar-action", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

function StatusButton({ model, actions }: { model: ToolbarViewModel; actions: ToolbarPrimaryActions }): UiNode {
  const statusOpen = model.openPanel === "status";
  return (
    <ToolbarIconButton
      icon="waypoints"
      label={statusOpen ? "Hide status" : "Show status"}
      className={["codex-panel__status-menu-toggle", statusOpen ? "is-active" : ""].filter(Boolean).join(" ")}
      onClick={actions.toggleStatusPanel}
    />
  );
}

function ToolbarPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  if (!model.openPanel) return null;
  return (
    <div
      className={["codex-panel__toolbar-panel", model.openPanel === "status" ? "codex-panel__toolbar-panel--status" : ""]
        .filter(Boolean)
        .join(" ")}
      data-codex-panel-toolbar-panel={model.openPanel}
    >
      {model.openPanel === "history" ? (
        <ThreadList
          threads={model.threads}
          initialLoading={model.threadListLoading}
          fetching={model.threadListFetching}
          hasMore={model.hasMoreThreads}
          loadingMore={model.loadingMoreThreads}
          error={model.threadListError}
          actions={actions.threads}
        />
      ) : null}
      {model.openPanel === "chat-actions" ? <ChatActionsPanel model={model} actions={actions.chat} /> : null}
      {model.openPanel === "status" ? <StatusPanel model={model} actions={actions.status} /> : null}
    </div>
  );
}

function ChatActionsPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarChatActions }): UiNode {
  return (
    <div className="codex-panel__chat-actions-panel-items">
      <ToolbarPanelItem
        label="Start new chat"
        onClick={actions.startNewThread}
        className="codex-panel__chat-actions-panel-item"
        disabled={model.newChatDisabled}
      />
      <ToolbarPanelItem
        label="Start side chat"
        onClick={actions.startSideChat}
        className="codex-panel__chat-actions-panel-item"
        disabled={model.sideChatStartDisabled}
      />
      <ToolbarPanelItem
        label="Compact context"
        onClick={actions.compactContext}
        className="codex-panel__chat-actions-panel-item"
        disabled={model.compactDisabled}
      />
      <ToolbarPanelItem
        label="Set goal..."
        onClick={actions.setGoal}
        className="codex-panel__chat-actions-panel-item"
        disabled={model.goalMutationDisabled}
      />
    </div>
  );
}

function StatusPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarStatusActions }): UiNode {
  return (
    <>
      <div className="codex-panel__status-panel-items">
        <ToolbarPanelItem label={model.connectLabel} onClick={actions.connect} className="codex-panel__status-panel-item" />
        <ToolbarPanelItem label="Refresh" onClick={actions.refreshStatus} className="codex-panel__status-panel-item" />
        <ToolbarPanelItem label="Copy debug details" onClick={actions.copyDebugDetails} className="codex-panel__status-panel-item" />
      </div>
      <RateLimitPanel rateLimit={model.rateLimit} />
      <DiagnosticSectionsPanel title="Connection diagnostics" sections={model.diagnostics} />
      <DiagnosticSectionsPanel title="Permissions & Approvals" sections={model.permissionsAndApprovals} />
      <DiagnosticSectionsPanel title="Codex capabilities" sections={model.toolInventory} />
    </>
  );
}

function RateLimitPanel({ rateLimit }: { rateLimit: RateLimitSummary | null }): UiNode {
  if (!rateLimit) return null;
  return (
    <div className="codex-panel__limit-panel">
      <div className="codex-panel__limit-panel-title">Usage limit</div>
      <div className="codex-panel__limit-panel-list">
        {rateLimit.rows.map((row) => (
          <div
            key={`${row.label}:${row.value}:${row.resetLabel ?? ""}`}
            className={
              row.level === "danger"
                ? "codex-panel__limit-panel-row codex-panel__limit-panel-row--danger"
                : row.level === "warn"
                  ? "codex-panel__limit-panel-row codex-panel__limit-panel-row--warn"
                  : "codex-panel__limit-panel-row"
            }
          >
            <div className="codex-panel__limit-panel-label">{row.label}</div>
            <div className="codex-panel__limit-panel-value">{row.value}</div>
            <div className="codex-panel__limit-panel-meter-cell">
              <div
                className={[
                  "codex-panel__limit-panel-meter",
                  row.meterDivisions ? "codex-panel__limit-panel-meter--divided" : "",
                  row.meterDivisions === 5
                    ? "codex-panel__limit-panel-meter--5"
                    : row.meterDivisions === 7
                      ? "codex-panel__limit-panel-meter--7"
                      : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={row.percent}
              >
                <div className="codex-panel__limit-panel-fill" style={{ width: `${String(row.percent)}%` }} />
              </div>
            </div>
            <div className="codex-panel__limit-panel-reset">{row.resetLabel ?? ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticSectionsPanel({ title, sections }: { title: string; sections: ToolbarStatusSection[] }): UiNode {
  return (
    <div className="codex-panel__status-diagnostics">
      <div className="codex-panel__status-diagnostics-title">{title}</div>
      {sections.map((section) => (
        <DiagnosticSection key={section.title} section={section} />
      ))}
    </div>
  );
}

function DiagnosticRows({ rows }: { rows: ToolbarStatusRow[] }): UiNode {
  return (
    <dl className="codex-panel__status-diagnostics-list">
      {rows.map((row) => (
        <DiagnosticRow key={`${row.label}:${row.value}:${row.level ?? "normal"}`} row={row} />
      ))}
    </dl>
  );
}

function DiagnosticSection({ section }: { section: ToolbarStatusSection }): UiNode {
  return (
    <>
      {section.title ? <div className="codex-panel__status-diagnostics-section">{section.title}</div> : null}
      <DiagnosticRows rows={section.rows} />
    </>
  );
}

function DiagnosticRow({ row }: { row: ToolbarStatusRow }): UiNode {
  const level = row.level ?? "normal";
  return (
    <div
      className={
        level === "error"
          ? "codex-panel__status-diagnostics-row codex-panel__status-diagnostics-row--error"
          : level === "warning"
            ? "codex-panel__status-diagnostics-row codex-panel__status-diagnostics-row--warning"
            : "codex-panel__status-diagnostics-row"
      }
    >
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  );
}

function ThreadList({
  threads,
  initialLoading,
  fetching,
  hasMore,
  loadingMore,
  error,
  actions,
}: {
  threads: ToolbarThreadRow[];
  initialLoading: boolean;
  fetching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  actions: ToolbarThreadActions;
}): UiNode {
  if (threads.length === 0 && !hasMore && !error) {
    return (
      <div className="codex-panel__threads">
        <ToolbarPanelItem
          label={initialLoading ? "Loading threads…" : "No threads"}
          disabled={true}
          className="codex-panel__thread codex-panel__thread--empty"
          interactive={false}
        />
      </div>
    );
  }
  const groups = pinnedThreadGroups(threads);
  return (
    <div className="codex-panel__threads">
      {groups.separated ? (
        <>
          {groups.pinned.map((thread) => (
            <ThreadListRow key={thread.threadId} thread={thread} actions={actions} />
          ))}
          <hr className="codex-panel__thread-group-divider" />
          {groups.unpinned.map((thread) => (
            <ThreadListRow key={thread.threadId} thread={thread} actions={actions} />
          ))}
        </>
      ) : (
        threads.map((thread) => <ThreadListRow key={thread.threadId} thread={thread} actions={actions} />)
      )}
      {error ? (
        <div className="codex-panel__thread-list-status codex-panel__thread-list-status--error" role="status">
          {error}
        </div>
      ) : null}
      {hasMore ? (
        <ToolbarPanelItem
          label={loadingMore ? "Loading more threads…" : "Load more threads"}
          disabled={fetching || loadingMore}
          className="codex-panel__thread codex-panel__thread--load-more"
          onClick={actions.loadMore}
        />
      ) : null}
    </div>
  );
}

function ThreadListRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarThreadActions }): UiNode {
  const archiveConfirm = archiveConfirmState(thread);
  return (
    <div
      className={[
        "codex-panel-ui__nav-row",
        "codex-panel__thread-row",
        thread.selected ? "codex-panel__thread-row--selected" : "",
        thread.selected ? "is-selected" : "",
        thread.rename ? "codex-panel__thread-row--renaming" : "",
        archiveConfirm.active ? "codex-panel__thread-row--archive-confirming" : "",
        archiveConfirm.active ? "codex-panel__archive-confirm" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {thread.rename ? (
        <ThreadRenameRow thread={thread} actions={actions} />
      ) : (
        <>
          <ToolbarPanelItem
            label={thread.title}
            selected={thread.selected}
            selectionStyle="row"
            className="codex-panel__thread"
            onClick={() => {
              actions.resume(thread.threadId);
            }}
          />
          <div className="codex-panel__thread-actions">
            {!archiveConfirm.active ? (
              <ToolbarRowActionButton
                icon="pencil"
                label="Rename thread"
                className="codex-panel__thread-action"
                disabled={thread.renameDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.rename.start(thread.threadId);
                }}
              />
            ) : null}
            <ArchiveControls thread={thread} actions={actions} />
            {!archiveConfirm.active ? <PinThreadButton thread={thread} actions={actions} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function PinThreadButton({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarThreadActions }): UiNode {
  return (
    <ToolbarRowActionButton
      icon="star"
      label={thread.isPinned === true ? "Unpin thread" : "Pin thread"}
      className={[
        "codex-panel__thread-action",
        "codex-panel__thread-pin",
        thread.isPinned === true ? "codex-panel__thread-pin--pinned" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={thread.isPinned === true}
      onClick={(event) => {
        event.stopPropagation();
        actions.setPinned(thread.threadId, thread.isPinned !== true);
      }}
    />
  );
}

function ArchiveControls({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarThreadActions }): UiNode {
  const archiveConfirm = archiveConfirmState(thread);
  if (!archiveConfirm.active) {
    return (
      <ToolbarRowActionButton
        icon="archive"
        label="Archive thread"
        className="codex-panel__thread-action"
        disabled={thread.archiveDisabled}
        onClick={(event) => {
          event.stopPropagation();
          actions.archive.start(thread.threadId);
        }}
      />
    );
  }
  const defaultSaveMarkdown = archiveConfirm.defaultSaveMarkdown;
  return (
    <>
      <ArchiveModeButton thread={thread} saveMarkdown={defaultSaveMarkdown} primary={true} actions={actions} />
      <ArchiveModeButton thread={thread} saveMarkdown={!defaultSaveMarkdown} primary={false} actions={actions} />
    </>
  );
}

function ArchiveModeButton({
  thread,
  saveMarkdown,
  primary,
  actions,
}: {
  thread: ToolbarThreadRow;
  saveMarkdown: boolean;
  primary: boolean;
  actions: ToolbarThreadActions;
}): UiNode {
  const label = saveMarkdown ? "Save and archive thread" : "Archive thread without saving";
  return (
    <ToolbarRowActionButton
      icon={saveMarkdown ? "save" : "trash"}
      label={label}
      className={`codex-panel__thread-action ${primary ? "codex-panel__archive-default" : "codex-panel__archive-alternate"}`}
      disabled={thread.archiveDisabled}
      onClick={(event) => {
        event.stopPropagation();
        actions.archive.confirm(thread.threadId, saveMarkdown);
      }}
    />
  );
}

function ThreadRenameRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarThreadActions }): UiNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generating = thread.rename?.generating ?? false;
  const saving = thread.rename?.saving ?? false;
  const renameBusy = generating || saving;
  const draft = thread.rename?.draft ?? thread.title;
  useLayoutEffect(() => {
    if (!renameBusy) focusToolbarRenameInput(inputRef.current);
  }, [draft, renameBusy]);

  return (
    <>
      <ToolbarPanelItem
        label={thread.title}
        className="codex-panel__thread codex-panel__thread-rename"
        interactive={false}
        renderContent={() => (
          <div className="codex-panel__thread-rename-field">
            <input
              ref={inputRef}
              className="codex-panel-ui__nav-inline-input codex-panel__thread-rename-input"
              type="text"
              value={draft}
              disabled={renameBusy}
              onInput={(event) => {
                actions.rename.updateDraft(thread.threadId, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!event.isComposing && !renameBusy) actions.rename.save(thread.threadId, event.currentTarget.value);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (!renameBusy) actions.rename.cancel(thread.threadId);
                }
              }}
              onBlur={(event) => {
                if (!renameBusy) actions.rename.save(thread.threadId, event.currentTarget.value);
              }}
            />
          </div>
        )}
      />
      <ToolbarRowActionButton
        icon={generating ? "x" : "sparkles"}
        label={generating ? "Cancel auto-name" : "Auto-name thread"}
        className="codex-panel__thread-action"
        disabled={saving || (!generating && (thread.rename?.autoNameDisabled ?? true))}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (generating) actions.rename.cancelAutoName(thread.threadId);
          else actions.rename.autoName(thread.threadId);
        }}
      />
    </>
  );
}

function ToolbarPanelItem({
  label,
  selected = false,
  disabled = false,
  selectionStyle = "item",
  meta,
  className = "",
  interactive = true,
  renderContent,
  onClick,
}: {
  label: string;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  selectionStyle?: "item" | "row" | undefined;
  meta?: string | undefined;
  className?: string | undefined;
  interactive?: boolean | undefined;
  renderContent?: () => UiNode;
  onClick?: () => void;
}): UiNode {
  const itemClassName = [
    "codex-panel-ui__nav-item",
    "codex-panel__toolbar-panel-item",
    className,
    selected && selectionStyle === "item" ? "is-selected" : "",
    disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = renderContent ? (
    renderContent()
  ) : (
    <>
      <span className="codex-panel__toolbar-panel-label">{label}</span>
      {meta ? <span className="codex-panel__toolbar-panel-meta">{meta}</span> : null}
    </>
  );
  if (!interactive) {
    return <div className={itemClassName}>{content}</div>;
  }
  return (
    // biome-ignore lint/a11y: Toolbar panel rows intentionally match Obsidian's native file explorer nav rows: pointer-first div items with state expressed by classes, while row icon actions remain real buttons.
    <div
      className={itemClassName}
      onClick={
        disabled
          ? undefined
          : () => {
              onClick?.();
            }
      }
    >
      {content}
    </div>
  );
}

function ToolbarRowActionButton({
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

function archiveConfirmState(thread: ToolbarThreadRow): { active: boolean; defaultSaveMarkdown: boolean } {
  return thread.archiveConfirm;
}
