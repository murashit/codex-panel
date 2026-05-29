import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

import type { EffectiveConfigSection, RateLimitSummary } from "../../../runtime/view";
import { IconButton, ObsidianIcon } from "../../../shared/ui/react-components";
import { renderReactRoot } from "../../../shared/ui/react-root";
import type { ToolbarDiagnosticSection, ToolbarThreadRow, ToolbarViewModel } from "../toolbar-model";

export interface ToolbarActions {
  toggleHistory: () => void;
  toggleAutoReview: () => void;
  toggleStatusPanel: () => void;
  togglePlan: () => void;
  toggleFast: () => void;
  toggleRuntime: () => void;
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

export function renderToolbar(toolbar: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  renderReactRoot(toolbar, <Toolbar model={model} actions={actions} />);
}

function Toolbar({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): ReactNode {
  return (
    <>
      <div className="codex-panel__toolbar-primary">
        <ToolbarIconButton
          icon="history"
          label={model.historyOpen ? "Hide thread list" : "Show thread list"}
          className="codex-panel__history-toggle"
          aria-pressed={model.historyOpen ? "true" : "false"}
          onClick={actions.toggleHistory}
        />
        <ToolbarIconButton
          icon="shield"
          label="Toggle auto-review"
          className={`codex-panel__auto-review-toggle ${model.autoReviewActive ? "is-active" : ""}`}
          aria-pressed={model.autoReviewActive ? "true" : "false"}
          onClick={actions.toggleAutoReview}
        />
        <div className="codex-panel__runtime-area">
          <RuntimeStrip model={model} actions={actions} />
        </div>
        <ContextMeter context={model.context} />
        <StatusButton model={model} actions={actions} />
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
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">): ReactNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={["clickable-icon codex-panel-ui__toolbar-control", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

function RuntimeStrip({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): ReactNode {
  return (
    <div className="codex-panel__runtime-strip">
      <RuntimeIcon icon="list-checks" label="Toggle plan mode" active={model.planActive} onClick={actions.togglePlan} />
      <RuntimeIcon icon="zap" label="Toggle fast mode" active={model.fastActive} onClick={actions.toggleFast} />
      <button
        className={[
          "clickable-icon",
          "codex-panel__runtime-model",
          "codex-panel-ui__toolbar-control",
          model.runtimeEmphasized ? "is-emphasized" : "",
          model.runtimeOpen ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        type="button"
        aria-label="Change model and reasoning effort"
        aria-expanded={model.runtimeOpen ? "true" : "false"}
        title={model.runtimeTitle}
        onClick={actions.toggleRuntime}
      >
        <span className="codex-panel__runtime-model-value">{model.runtimeSummary}</span>
      </button>
    </div>
  );
}

function RuntimeIcon({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }): ReactNode {
  return (
    <ToolbarIconButton
      icon={icon}
      label={label}
      className={`codex-panel__runtime-icon ${active ? "is-active" : ""}`}
      aria-pressed={active ? "true" : "false"}
      onClick={onClick}
    />
  );
}

function ContextMeter({ context }: { context: ToolbarViewModel["context"] }): ReactNode {
  if (!context) return null;
  return (
    <div className={`codex-panel__meter-compact codex-panel__context-compact codex-panel__meter-compact--${context.level}`}>
      <span className="codex-panel__meter-compact-label codex-panel__context-compact-label">{context.label}</span>
      <span className="codex-panel__meter-compact-bar codex-panel__context-compact-bar">
        <span
          className="codex-panel__meter-compact-fill codex-panel__context-compact-fill"
          style={{ width: `${String(context.percent ?? 0)}%` }}
        />
      </span>
    </div>
  );
}

function StatusButton({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): ReactNode {
  return (
    <button
      className={[
        "clickable-icon codex-panel-ui__toolbar-control codex-panel__status-dot",
        `codex-panel__status-dot--${model.statusState}`,
        model.statusPanelOpen ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={model.statusPanelOpen ? "Hide connection status" : "Show connection status"}
      aria-expanded={model.statusPanelOpen ? "true" : "false"}
      onClick={actions.toggleStatusPanel}
    />
  );
}

function ToolbarPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): ReactNode {
  if (!model.openPanel) return null;
  return (
    <div className={`codex-panel__toolbar-panel codex-panel__toolbar-panel--${model.openPanel}`}>
      {model.openPanel === "history" ? <ThreadList threads={model.threads} actions={actions} /> : null}
      {model.openPanel === "runtime" ? <RuntimePicker model={model} /> : null}
      {model.openPanel === "status" ? <StatusPanel model={model} actions={actions} /> : null}
    </div>
  );
}

function StatusPanel({ model, actions }: { model: ToolbarViewModel; actions: ToolbarActions }): ReactNode {
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
      <EffectiveConfigPanel sections={model.configSections} />
    </>
  );
}

function RateLimitPanel({ rateLimit }: { rateLimit: RateLimitSummary | null }): ReactNode {
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
            <div className="codex-panel__limit-panel-meter">
              <div className="codex-panel__limit-panel-fill" style={{ width: `${String(row.percent)}%` }} />
            </div>
            <div className="codex-panel__limit-panel-reset">{row.resetLabel ?? ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionDiagnostics({ sections }: { sections: ToolbarDiagnosticSection[] }): ReactNode {
  return (
    <div className="codex-panel__connection-diagnostics">
      <div className="codex-panel__connection-diagnostics-title">Connection</div>
      {sections.map((section) => (
        <DiagnosticSection key={section.title} section={section} />
      ))}
    </div>
  );
}

function DiagnosticSection({ section }: { section: ToolbarDiagnosticSection }): ReactNode {
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

function EffectiveConfigPanel({ sections }: { sections: EffectiveConfigSection[] }): ReactNode {
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

function FragmentedConfigSection({ section }: { section: EffectiveConfigSection }): ReactNode {
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

function RuntimePicker({ model }: { model: ToolbarViewModel }): ReactNode {
  return (
    <div className="codex-panel__runtime-picker" role="listbox">
      <div className="codex-panel__runtime-picker-label">Reasoning effort</div>
      {model.effortChoices.map((choice) => (
        <ToolbarPanelItem
          key={`effort:${choice.label}`}
          label={choice.label}
          selected={choice.selected}
          disabled={choice.disabled}
          meta={choice.meta}
          onClick={choice.onClick}
          className="codex-panel__runtime-choice"
          role="option"
        />
      ))}
      <div className="codex-panel__runtime-picker-label">Model</div>
      {model.modelChoices.map((choice) => (
        <ToolbarPanelItem
          key={`model:${choice.label}`}
          label={choice.label}
          selected={choice.selected}
          disabled={choice.disabled}
          meta={choice.meta}
          onClick={choice.onClick}
          className="codex-panel__runtime-choice"
          role="option"
        />
      ))}
    </div>
  );
}

function ThreadList({ threads, actions }: { threads: ToolbarThreadRow[]; actions: ToolbarActions }): ReactNode {
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

function ThreadListRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): ReactNode {
  const archiveConfirm = archiveConfirmState(thread);
  return (
    <div
      className={[
        "codex-panel__thread-row",
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
            disabled={thread.disabled}
            className="codex-panel__thread"
            onClick={() => {
              actions.resumeThread(thread.threadId);
            }}
          />
          {!archiveConfirm.active ? (
            <ToolbarIconButton
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

function ArchiveActions({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): ReactNode {
  const archiveConfirm = archiveConfirmState(thread);
  if (!archiveConfirm.active) {
    return (
      <ToolbarIconButton
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
}): ReactNode {
  const label = saveMarkdown ? "Save and archive thread" : "Archive thread without saving";
  return (
    <ToolbarIconButton
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

function ThreadRenameRow({ thread, actions }: { thread: ToolbarThreadRow; actions: ToolbarActions }): ReactNode {
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
              className="codex-panel__thread-rename-input"
              type="text"
              value={draft}
              aria-label={`Rename ${thread.title}`}
              onChange={(event) => {
                actions.updateRenameDraft(thread.threadId, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!event.nativeEvent.isComposing && !generating) actions.saveRenameThread(thread.threadId, event.currentTarget.value);
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
      <ToolbarIconButton
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
  meta?: string | undefined;
  className?: string | undefined;
  interactive?: boolean | undefined;
  role?: "button" | "menuitem" | "option";
  renderContent?: () => ReactNode;
  onClick?: () => void;
}): ReactNode {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onClick?.();
  };
  return (
    <div
      className={["codex-panel__toolbar-panel-item", className, selected ? "is-checked" : "", disabled ? "is-disabled" : ""]
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
      <ToolbarPanelCheck selected={selected} />
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

function ToolbarPanelCheck({ selected }: { selected: boolean }): ReactNode {
  return selected ? (
    <ObsidianIcon icon="check" className="codex-panel__toolbar-panel-check" />
  ) : (
    <span className="codex-panel__toolbar-panel-check" aria-hidden="true" />
  );
}

function archiveConfirmState(thread: ToolbarThreadRow): { active: boolean; defaultSaveMarkdown: boolean } {
  return thread.archiveConfirm ?? { active: false, defaultSaveMarkdown: false };
}
