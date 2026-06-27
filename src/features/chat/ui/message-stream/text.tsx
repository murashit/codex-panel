import { Fragment, type ComponentChild as UiNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { IconButton } from "../../../../shared/ui/components.obsidian";
import type {
  EditedFilesTextView,
  MentionedFileTextView,
  MessageStreamTextView,
  ReferencedThreadTextView,
  TextItemDetailSectionView,
} from "../../presentation/message-stream/text-view";
import type { TextItemActionContext, TextItemContext, TextItemDetailStateContext, TextItemMetadataContext } from "./context";
import { closeMessageRoleMenuOnOutsidePointer } from "./message-stream.dom";
import { CollapsibleTextContent, TextContent } from "./text-content.dom";

export function textNode(view: MessageStreamTextView, context: TextItemContext): UiNode {
  return <Text view={view} context={context} />;
}

function Text({ view, context }: { view: MessageStreamTextView; context: TextItemContext }): UiNode {
  return (
    <div className={view.className}>
      <TextHeader view={view} context={context} />
      {view.collapsible ? (
        <CollapsibleTextContent view={view} context={context} />
      ) : (
        <TextContent key={view.contentKey} view={view} context={context} />
      )}
      {view.metadata.editedFiles ? <EditedFiles view={view.metadata.editedFiles} context={context} /> : null}
      {view.metadata.referencedThread ? <ReferencedThread reference={view.metadata.referencedThread} /> : null}
      {view.metadata.mentionedFiles ? (
        <MentionedFiles itemId={view.metadata.mentionedFiles.itemId} files={view.metadata.mentionedFiles.files} context={context} />
      ) : null}
      {view.metadata.autoReviewSummaries.length > 0 ? <AutoReviewSummaries summaries={[...view.metadata.autoReviewSummaries]} /> : null}
      {view.metadata.systemDetails.length > 0 ? <SystemDetails details={view.metadata.systemDetails} /> : null}
      {view.metadata.userInputDetails.length > 0 ? (
        <TextDetails itemId={view.id} details={view.metadata.userInputDetails} context={context} />
      ) : null}
    </div>
  );
}

function TextHeader({ view, context }: { view: MessageStreamTextView; context: TextItemActionContext }): UiNode {
  const forkMenuOpen = context.forkMenuItemId === view.id;
  const roleRef = useRef<HTMLDivElement | null>(null);
  const { fork, implementPlan, rollback } = view.actionTargets;

  useEffect(() => {
    if (!forkMenuOpen) return;
    const role = roleRef.current;
    if (!role) return;
    return closeMessageRoleMenuOnOutsidePointer(role, () => {
      context.onForkMenuToggle?.(null);
    });
  }, [context, forkMenuOpen]);

  const copyAction =
    view.copyText !== undefined && context.copyText && !forkMenuOpen ? (
      <TextAction
        icon="copy"
        label="Copy message"
        className="codex-panel__copy-message"
        onClick={() => context.copyText?.(view.copyText ?? "")}
      />
    ) : null;

  return (
    <div ref={roleRef} className={`codex-panel__message-role${forkMenuOpen ? " codex-panel__message-role--fork-open" : ""}`}>
      <span>{view.roleLabel}</span>
      {forkMenuOpen && fork ? (
        <TextAction
          icon="archive"
          label="Fork and archive"
          className="codex-panel__fork-and-archive-message"
          onClick={() => {
            context.onForkMenuToggle?.(null);
            context.onFork?.(fork, true);
          }}
        />
      ) : (
        copyAction
      )}
      {fork ? (
        <TextAction
          icon={forkMenuOpen ? "file-plus-corner" : "lucide-split"}
          label={forkMenuOpen ? "Fork" : "Fork from here"}
          className="codex-panel__fork-message"
          onClick={() => {
            if (forkMenuOpen) {
              context.onForkMenuToggle?.(null);
              context.onFork?.(fork, false);
            } else {
              context.onForkMenuToggle?.(view.id);
            }
          }}
        />
      ) : null}
      {implementPlan ? (
        <TextAction
          icon="play"
          label="Implement plan"
          className="codex-panel__implement-plan"
          onClick={() => context.onImplementPlan?.(implementPlan)}
        />
      ) : null}
      {rollback ? (
        <TextAction
          icon="undo-2"
          label="Rollback last turn"
          className="codex-panel__rollback-turn"
          onClick={() => context.onRollback?.()}
        />
      ) : null}
    </div>
  );
}

function TextAction({ icon, label, className, onClick }: { icon: string; label: string; className: string; onClick: () => void }): UiNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel__message-action ${className}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

function ReferencedThread({ reference }: { reference: ReferencedThreadTextView }): UiNode {
  return (
    <div className="codex-panel__referenced-thread">
      <span className="codex-panel__referenced-thread-label">
        <span>Referenced </span>
        <span>{reference.title}</span>
        <span className="codex-panel__edited-files-separator">·</span>
        <span>
          {reference.includedTurns}/{reference.turnLimit} turns
        </span>
      </span>
    </div>
  );
}

function EditedFiles({ view, context }: { view: EditedFilesTextView; context: TextItemMetadataContext }): UiNode {
  const editedFiles = view.files;
  const turnDiff = view.turnDiff;
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  return (
    <div className="codex-panel__edited-files">
      <details className="codex-panel__edited-files-details">
        <summary tabIndex={-1}>
          <span className="codex-panel__edited-files-summary">
            <span>{label}</span>
            {turnDiff && context.activeThreadId && context.openTurnDiff ? (
              <>
                <span className="codex-panel__edited-files-separator">·</span>
                <IconButton
                  icon="file-diff"
                  label="View diff"
                  className="clickable-icon codex-panel__open-turn-diff"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    context.openTurnDiff?.({
                      threadId: context.activeThreadId ?? "",
                      turnId: turnDiff.turnId,
                      cwd: context.workspaceRoot ?? null,
                      files: [...editedFiles],
                      diff: turnDiff.diff,
                    });
                  }}
                >
                  <span className="codex-panel__open-turn-diff-label">View diff</span>
                </IconButton>
              </>
            ) : null}
          </span>
        </summary>
        <ul>
          {editedFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function MentionedFiles({
  itemId,
  files,
  context,
}: {
  itemId: string;
  files: readonly MentionedFileTextView[];
  context: TextItemDetailStateContext;
}): UiNode {
  const label = files.length === 1 ? "Mentioned 1 file" : `Mentioned ${String(files.length)} files`;
  return (
    <RememberedDetails
      wrapperClassName="codex-panel__mentioned-files"
      detailsClassName="codex-panel__mentioned-files-details"
      detailsKey={`${itemId}:mentioned-files`}
      summary={label}
      context={context}
    >
      <ul>
        {files.map((file) => (
          <li key={`${file.name}\n${file.path}`}>
            <span>{file.name}</span>
            <span className="codex-panel__edited-files-separator"> · </span>
            <span>{file.path}</span>
          </li>
        ))}
      </ul>
    </RememberedDetails>
  );
}

function AutoReviewSummaries({ summaries }: { summaries: string[] }): UiNode {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${String(summaries.length)} requests`;
  return (
    <details className="codex-panel__auto-reviews">
      <summary tabIndex={-1}>{label}</summary>
      <ul>
        {summaries.map((summary, index) => (
          <li key={`${String(index)}:${summary}`}>{summary}</li>
        ))}
      </ul>
    </details>
  );
}

function TextDetails({
  itemId,
  details,
  context,
}: {
  itemId: string;
  details: readonly TextItemDetailSectionView[];
  context: TextItemDetailStateContext;
}): UiNode {
  return (
    <>
      {details.map((section, index) => (
        <RememberedDetails
          key={`${section.title ?? "Details"}:${String(index)}`}
          detailsClassName="codex-panel__output"
          detailsKey={`${itemId}:text-item-detail:${String(index)}`}
          summary={section.title ?? "Details"}
          context={context}
        >
          <DetailSectionBody section={section} />
        </RememberedDetails>
      ))}
    </>
  );
}

function SystemDetails({ details }: { details: readonly TextItemDetailSectionView[] }): UiNode {
  return (
    <div className="codex-panel__system-result-grid">
      {details.map((section, index) => (
        <Fragment key={`${section.title ?? ""}:${String(index)}`}>
          {section.title ? <div className="codex-panel__system-result-heading">{section.title}</div> : null}
          {section.facts?.map((row) => (
            <Fragment key={`${row.key}\n${row.value}`}>
              <div className="codex-panel__system-result-key">{row.key}</div>
              <div className="codex-panel__system-result-value">{row.value}</div>
            </Fragment>
          ))}
          {section.body ? <pre className="codex-panel__system-result-body">{section.body}</pre> : null}
        </Fragment>
      ))}
    </div>
  );
}

function DetailSectionBody({ section }: { section: TextItemDetailSectionView }): UiNode {
  return (
    <>
      {section.facts && section.facts.length > 0 ? (
        <dl className="codex-panel__meta-grid">
          {section.facts.map((row) => (
            <Fragment key={`${row.key}\n${row.value}`}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {section.body ? <pre>{section.body}</pre> : null}
    </>
  );
}

function RememberedDetails({
  wrapperClassName,
  detailsClassName,
  detailsKey,
  summary,
  context,
  children,
}: {
  wrapperClassName?: string;
  detailsClassName: string;
  detailsKey: string;
  summary: string;
  context: TextItemDetailStateContext;
  children: UiNode;
}): UiNode {
  const details = (
    <details
      className={detailsClassName}
      open={context.disclosures.textDetails.has(detailsKey)}
      onToggle={(event) => {
        context.onDisclosureToggle?.("textDetails", detailsKey, event.currentTarget.open);
      }}
    >
      <summary tabIndex={-1}>{summary}</summary>
      {children}
    </details>
  );
  return wrapperClassName ? <div className={wrapperClassName}>{details}</div> : details;
}
