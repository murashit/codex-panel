import type { ButtonHTMLAttributes, ComponentChild as UiNode, TargetedKeyboardEvent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import type { RuntimeConfigSection, RateLimitSummary } from "../presentation/runtime/status";
import { IconButton } from "../../../shared/ui/components";

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

interface ToolbarDiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

interface ToolbarDiagnosticSection {
  title: string;
  rows: ToolbarDiagnosticRow[];
}

export interface ToolbarViewModel {
  newChatDisabled: boolean;
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  rateLimit: RateLimitSummary | null;
  configSections: RuntimeConfigSection[];
  openPanel: "history" | "chat-actions" | "status" | null;
  threads: ToolbarThreadRow[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}

export interface ToolbarActions {
  startNewThread: () => void;
  toggleChatActions: () => void;
  compactConversation: () => void;
  setGoal: () => void;
  toggleHistory: () => void;
  toggleStatusPanel: () => void;
  connect: () => void;
  refreshStatus: () => void;
  resumeThread: (threadId: string) => void;
  startArchiveThread: (threadId: string) => void;
  archiveThread: (threadId: string, saveMarkdown: boolean) => void;
  startRenameThread: (threadId: string) => void;
  updateRenameDraft: (threadId: string, value: string) => void;
  saveRenameThread: (threadId: string, value: string) => void;
  cancelRenameThread: (threadId: string) => void;
  autoNameThread: (threadId: string) => void;
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
            aria-pressed={model.historyOpen ? "true" : "false"}
            onClick={actions.toggleHistory}
          />
          <ToolbarIconButton
            icon="messages-square"
            label={model.chatActionsOpen ? "Hide chat actions" : "Show chat actions"}
            className={["codex-panel__new-chat", model.chatActionsOpen ? "is-active" : ""].filter(Boolean).join(" ")}
            disabled={model.newChatDisabled}
            aria-expanded={model.chatActionsOpen ? "true" : "false"}
            onClick={actions.toggleChatActions}
          />
          <StatusButton model={model} actions={actions} />
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
} & Omit<ButtonProps, "className" | "type">): UiNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={["clickable-icon nav-action-button codex-panel-ui__toolbar-action", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

function StatusButton({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  return (
    <ToolbarIconButton
      icon="waypoints"
      label={model.statusPanelOpen ? "Hide Codex status and settings" : "Show Codex status and settings"}
      className={["codex-panel__status-menu-toggle", model.statusPanelOpen ? "is-active" : ""].filter(Boolean).join(" ")}
      aria-expanded={model.statusPanelOpen ? "true" : "false"}
      onClick={actions.toggleStatusPanel}
    />
  );
}

function ToolbarPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  if (!model.openPanel) return null;
  return (
    <div className={`codex-panel__toolbar-panel codex-panel__toolbar-panel--${model.openPanel}`}>
      {model.openPanel === "history" ? <ThreadList threads={model.threads} actions={actions} /> : null}
      {model.openPanel === "chat-actions" ? <ChatActionsPanel model={model} actions={actions} /> : null}
      {model.openPanel === "status" ? <StatusPanel model={model} actions={actions} /> : null}
    </div>
  );
}

function ChatActionsPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  return (
    <div className="codex-panel__chat-actions-panel-items" role="menu">
      <ToolbarPanelItem
        label="Start new chat"
        onClick={actions.startNewThread}
        className="codex-panel__chat-actions-panel-item"
        disabled={model.newChatDisabled}
        role="menuitem"
      />
      <ToolbarPanelItem
        label="Compact conversation"
        onClick={actions.compactConversation}
        className="codex-panel__chat-actions-panel-item"
        role="menuitem"
      />
      <ToolbarPanelItem label="Set goal..." onClick={actions.setGoal} className="codex-panel__chat-actions-panel-item" role="menuitem" />
    </div>
  );
}

function StatusPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): UiNode {
  return (
    <>
      <div className="codex-panel__status-panel-items" role="menu">
        <ToolbarPanelItem label={model.connectLabel} onClick={actions.connect} className="codex-panel__status-panel-item" role="menuitem" />
        <ToolbarPanelItem
          label="Refresh status"
          onClick={actions.refreshStatus}
          className="codex-panel__status-panel-item"
          role="menuitem"
        />
      </div>
      <RateLimitPanel rateLimit={model.rateLimit} />
      <ConnectionDiagnostics sections={model.diagnostics} />
      <RuntimeConfigPanel sections={model.configSections} />
    </>
  );
}

function RateLimitPanel({ rateLimit }: { rateLimit: RateLimitSummary | null }): UiNode {
  if (!rateLimit) return null;
  return (
    <div className={`codex-panel__limit-panel codex-panel__limit-panel--${rateLimit.level}`}>
      <div className="codex-panel__limit-panel-title">Usage limit</div>
      <div className="codex-panel__limit-panel-list">
        {rateLimit.rows.map((row) => (
          <div
            key={`${row.label}:${row.value}:${row.resetLabel ?? ""}`}
            className={`codex-panel__limit-panel-row codex-panel__limit-panel-row--${row.level}`}
          >
            <div className="codex-panel__limit-panel-label">{row.label}</div>
            <div className="codex-panel__limit-panel-value">{row.value}</div>
            <div className="codex-panel__limit-panel-meter-cell">
              <div
                className={[
                  "codex-panel__limit-panel-meter",
                  row.meterDivisions ? "codex-panel__limit-panel-meter--divided" : "",
                  row.meterDivisions ? `codex-panel__limit-panel-meter--${String(row.meterDivisions)}` : "",
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

function ConnectionDiagnostics({ sections }: { sections: ToolbarDiagnosticSection[] }): UiNode {
  return (
    <div className="codex-panel__connection-diagnostics">
      <div className="codex-panel__connection-diagnostics-title">Connection</div>
      {sections.map((section) => (
        <DiagnosticSection key={section.title} section={section} />
      ))}
    </div>
  );
}

function DiagnosticSection({ section }: { section: ToolbarDiagnosticSection }): UiNode {
  return (
    <>
      <div className="codex-panel__connection-diagnostics-section">{section.title}</div>
      <dl className="codex-panel__connection-diagnostics-list">
        {section.rows.map((row) => (
          <div
            key={`${row.label}:${row.value}:${row.level ?? "normal"}`}
            className={`codex-panel__connection-diagnostics-row codex-panel__connection-diagnostics-row--${row.level ?? "normal"}`}
          >
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function RuntimeConfigPanel({ sections }: { sections: RuntimeConfigSection[] }): UiNode {
  return (
    <div className="codex-panel__config">
      <div className="codex-panel__config-title">Effective Codex config</div>
      <dl className="codex-panel__config-list">
        {sections.map((section) => (
          <FragmentedConfigSection key={section.title} section={section} />
        ))}
      </dl>
    </div>
  );
}

function FragmentedConfigSection({ section }: { section: RuntimeConfigSection }): UiNode {
  return (
    <>
      <div className="codex-panel__config-section">{section.title}</div>
      {section.rows.map((row) => (
        <div key={`${row.key}\n${row.value}`} className="codex-panel__config-row">
          <dt>{row.key}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </>
  );
}

function ThreadList({ threads, actions }: { threads: ToolbarThreadRow[]; actions: ToolbarActions }): UiNode {
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

function ThreadListRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): UiNode {
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
              actions.resumeThread(thread.threadId);
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
                actions.startRenameThread(thread.threadId);
              }}
            />
          ) : null}
          {thread.canArchive ? <ArchiveActions thread={thread} actions={actions} /> : null}
        </>
      )}
    </div>
  );
}

function ArchiveActions({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): UiNode {
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
          actions.startArchiveThread(thread.threadId);
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
  actions: ToolbarActions;
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
        actions.archiveThread(thread.threadId, saveMarkdown);
      }}
    />
  );
}

function ThreadRenameRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): UiNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generating = thread.rename?.generating ?? false;
  const draft = thread.rename?.draft ?? thread.title;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.ownerDocument.activeElement !== input) {
      input.focus();
      input.select();
    }
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
                actions.updateRenameDraft(thread.threadId, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!event.isComposing && !generating) actions.saveRenameThread(thread.threadId, event.currentTarget.value);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  actions.cancelRenameThread(thread.threadId);
                }
              }}
              onBlur={(event) => {
                if (!generating) actions.saveRenameThread(thread.threadId, event.currentTarget.value);
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
          actions.autoNameThread(thread.threadId);
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
  role = "button",
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
  role?: "button" | "menuitem" | "option";
  renderContent?: () => UiNode;
  onClick?: () => void;
}): UiNode {
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>) => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onClick?.();
  };
  return (
    <div
      className={[
        "codex-panel-ui__nav-item",
        "codex-panel__toolbar-panel-item",
        className,
        selected && selectionStyle === "item" ? "is-selected" : "",
        disabled ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={interactive ? role : undefined}
      tabIndex={interactive ? (disabled ? -1 : 0) : undefined}
      aria-disabled={interactive ? (disabled ? "true" : "false") : undefined}
      aria-selected={interactive && role === "option" ? (selected ? "true" : "false") : undefined}
      aria-current={interactive && role === "button" && selected ? "true" : undefined}
      onClick={
        interactive
          ? () => {
              if (!disabled) onClick?.();
            }
          : undefined
      }
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      {renderContent ? (
        renderContent()
      ) : (
        <>
          <span className="codex-panel__toolbar-panel-label">{label}</span>
          {meta ? <span className="codex-panel__toolbar-panel-meta">{meta}</span> : null}
        </>
      )}
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
