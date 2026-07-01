import type { ButtonHTMLAttributes, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { IconButton, ObsidianToolbarAction, type ObsidianToolbarActionProps } from "../../../shared/obsidian/components.obsidian";
import type { RateLimitSummary } from "../presentation/runtime/status";
import { focusToolbarRenameInput } from "./toolbar.dom";

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

export interface ToolbarThreadRow {
  title: string;
  threadId: string;
  selected: boolean;
  disabled: boolean;
  canArchive: boolean;
  archiveConfirm?: { active: boolean; defaultSaveMarkdown: boolean };
  rename: {
    draft: string;
    generating: boolean;
  } | null;
}

interface ToolbarStatusRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

interface ToolbarStatusSection {
  title: string;
  rows: ToolbarStatusRow[];
}

export interface ToolbarViewModel {
  newChatDisabled: boolean;
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  rateLimit: RateLimitSummary | null;
  debugDetails: () => string;
  openPanel: "history" | "chat-actions" | "status" | null;
  threads: ToolbarThreadRow[];
  connectLabel: string;
  runtimePermissionsTitle: string;
  runtimePermissions: ToolbarStatusSection[];
  diagnostics: ToolbarStatusSection[];
  toolInventory: ToolbarStatusSection[];
}

interface ToolbarPrimaryActions {
  toggleHistory: () => void;
  toggleChatActions: () => void;
  toggleStatusPanel: () => void;
}

interface ToolbarChatActions {
  startNewThread: () => void;
  compactConversation: () => void;
  setGoal: () => void;
}

interface ToolbarStatusActions {
  connect: () => void;
  refreshStatus: () => void;
  copyDebugDetails: (details: string) => void;
}

interface ToolbarThreadActions {
  resume: (threadId: string) => void;
  archive: {
    start: (threadId: string) => void;
    confirm: (threadId: string, saveMarkdown: boolean) => void;
  };
  rename: {
    start: (threadId: string) => void;
    updateDraft: (threadId: string, value: string) => void;
    save: (threadId: string, value: string) => void;
    cancel: (threadId: string) => void;
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
  return (
    <>
      <div className="nav-header codex-panel__toolbar-primary">
        <div className="nav-buttons-container codex-panel__toolbar-buttons">
          <ToolbarIconButton
            icon="history"
            label={model.historyOpen ? "Hide thread list" : "Show thread list"}
            className={["codex-panel__history-toggle", model.historyOpen ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={actions.primary.toggleHistory}
          />
          <ToolbarIconButton
            icon="messages-square"
            label={model.chatActionsOpen ? "Hide chat actions" : "Show chat actions"}
            className={["codex-panel__new-chat", model.chatActionsOpen ? "is-active" : ""].filter(Boolean).join(" ")}
            disabled={model.newChatDisabled}
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
  return (
    <ToolbarIconButton
      icon="waypoints"
      label={model.statusPanelOpen ? "Hide status" : "Show status"}
      className={["codex-panel__status-menu-toggle", model.statusPanelOpen ? "is-active" : ""].filter(Boolean).join(" ")}
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
      {model.openPanel === "history" ? <ThreadList threads={model.threads} actions={actions.threads} /> : null}
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
        label="Compact conversation"
        onClick={actions.compactConversation}
        className="codex-panel__chat-actions-panel-item"
      />
      <ToolbarPanelItem label="Set goal..." onClick={actions.setGoal} className="codex-panel__chat-actions-panel-item" />
    </div>
  );
}

function StatusPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarStatusActions }): UiNode {
  return (
    <>
      <div className="codex-panel__status-panel-items">
        <ToolbarPanelItem label={model.connectLabel} onClick={actions.connect} className="codex-panel__status-panel-item" />
        <ToolbarPanelItem label="Refresh" onClick={actions.refreshStatus} className="codex-panel__status-panel-item" />
        <ToolbarPanelItem
          label="Copy debug details"
          onClick={() => {
            actions.copyDebugDetails(model.debugDetails());
          }}
          className="codex-panel__status-panel-item"
        />
      </div>
      <RateLimitPanel rateLimit={model.rateLimit} />
      <DiagnosticSectionsPanel title="Connection diagnostics" sections={model.diagnostics} />
      <DiagnosticSectionsPanel title={model.runtimePermissionsTitle} sections={model.runtimePermissions} />
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
    <div className="codex-panel__connection-diagnostics">
      <div className="codex-panel__connection-diagnostics-title">{title}</div>
      {sections.map((section) => (
        <DiagnosticSection key={section.title} section={section} />
      ))}
    </div>
  );
}

function DiagnosticRows({ rows }: { rows: ToolbarStatusRow[] }): UiNode {
  return (
    <dl className="codex-panel__connection-diagnostics-list">
      {rows.map((row) => (
        <DiagnosticRow key={`${row.label}:${row.value}:${row.level ?? "normal"}`} row={row} />
      ))}
    </dl>
  );
}

function DiagnosticSection({ section }: { section: ToolbarStatusSection }): UiNode {
  return (
    <>
      {section.title ? <div className="codex-panel__connection-diagnostics-section">{section.title}</div> : null}
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
          ? "codex-panel__connection-diagnostics-row codex-panel__connection-diagnostics-row--error"
          : level === "warning"
            ? "codex-panel__connection-diagnostics-row codex-panel__connection-diagnostics-row--warning"
            : "codex-panel__connection-diagnostics-row"
      }
    >
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  );
}

function ThreadList({ threads, actions }: { threads: ToolbarThreadRow[]; actions: ToolbarThreadActions }): UiNode {
  if (threads.length === 0) {
    return (
      <div className="codex-panel__threads">
        <ToolbarPanelItem
          label="No threads"
          disabled={true}
          className="codex-panel__thread codex-panel__thread--empty"
          interactive={false}
        />
      </div>
    );
  }
  return (
    <div className="codex-panel__threads">
      {threads.map((thread) => (
        <ThreadListRow key={thread.threadId} thread={thread} actions={actions} />
      ))}
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
            disabled={thread.disabled}
            className="codex-panel__thread"
            onClick={() => {
              actions.resume(thread.threadId);
            }}
          />
          {!archiveConfirm.active ? (
            <ToolbarRowActionButton
              icon="pencil"
              label="Rename thread"
              className="codex-panel__thread-action"
              disabled={thread.disabled}
              onClick={(event) => {
                event.stopPropagation();
                actions.rename.start(thread.threadId);
              }}
            />
          ) : null}
          {thread.canArchive ? <ArchiveControls thread={thread} actions={actions} /> : null}
        </>
      )}
    </div>
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
        disabled={thread.disabled}
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
      <ArchiveModeButton thread={thread} saveMarkdown={!defaultSaveMarkdown} primary={false} actions={actions} />
      <ArchiveModeButton thread={thread} saveMarkdown={defaultSaveMarkdown} primary={true} actions={actions} />
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
      disabled={thread.disabled}
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
  const draft = thread.rename?.draft ?? thread.title;
  useLayoutEffect(() => {
    focusToolbarRenameInput(inputRef.current);
  }, [draft]);

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
              onInput={(event) => {
                actions.rename.updateDraft(thread.threadId, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!event.isComposing && !generating) actions.rename.save(thread.threadId, event.currentTarget.value);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  actions.rename.cancel(thread.threadId);
                }
              }}
              onBlur={(event) => {
                if (!generating) actions.rename.save(thread.threadId, event.currentTarget.value);
              }}
            />
          </div>
        )}
      />
      <ToolbarRowActionButton
        icon={generating ? "loader" : "sparkles"}
        label="Auto-name thread"
        className="codex-panel__thread-action"
        disabled={generating}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          actions.rename.autoName(thread.threadId);
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
  return thread.archiveConfirm ?? { active: false, defaultSaveMarkdown: false };
}
