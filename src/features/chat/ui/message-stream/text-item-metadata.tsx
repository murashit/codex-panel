import { Fragment, type ComponentChild as UiNode } from "preact";

import type { MessageStreamItemAnnotations } from "../../presentation/message-stream/layout";
import type {
  MessageStreamItem,
  MessageStreamNoticeSection,
  MessageStreamUserInputQuestionResult,
} from "../../domain/message-stream/model/items";
import { IconButton } from "../../../../shared/ui/components";
import type { TextItemDetailStateContext, TextItemMetadataContext } from "./context";

export function ReferencedThread({ item }: { item: Extract<MessageStreamItem, { kind: "message" }> }): UiNode {
  const reference = item.referencedThread;
  if (!reference) return null;
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

export function EditedFiles({
  item,
  annotations,
  context,
}: {
  item: Extract<MessageStreamItem, { kind: "message" }>;
  annotations?: MessageStreamItemAnnotations;
  context: TextItemMetadataContext;
}): UiNode {
  const editedFiles = annotations?.editedFiles ?? [];
  const turnDiff = annotations?.turnDiff;
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  return (
    <div className="codex-panel__edited-files">
      <details className="codex-panel__edited-files-details">
        <summary tabIndex={-1}>
          <span className="codex-panel__edited-files-summary">
            <span>{label}</span>
            {turnDiff && item.turnId && context.activeThreadId && context.openTurnDiff ? (
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
                      turnId: item.turnId ?? "",
                      cwd: context.workspaceRoot ?? null,
                      files: editedFiles,
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

export function MentionedFiles({
  item,
  context,
}: {
  item: Extract<MessageStreamItem, { kind: "message" }>;
  context: TextItemDetailStateContext;
}): UiNode {
  const mentionedFiles = item.mentionedFiles ?? [];
  const label = mentionedFiles.length === 1 ? "Mentioned 1 file" : `Mentioned ${String(mentionedFiles.length)} files`;
  return (
    <RememberedDetails
      wrapperClassName="codex-panel__mentioned-files"
      detailsClassName="codex-panel__mentioned-files-details"
      detailsKey={`${item.id}:mentioned-files`}
      summary={label}
      context={context}
    >
      <ul>
        {mentionedFiles.map((file) => (
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

export function AutoReviewSummaries({ summaries }: { summaries: string[] }): UiNode {
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

export function TextItemDetails({
  itemId,
  details,
  context,
}: {
  itemId: string;
  details: TextItemDetailSection[];
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

export function SystemDetails({ details }: { details: MessageStreamNoticeSection[] }): UiNode {
  return (
    <>
      {details.map((section, index) => (
        <div key={`${section.title ?? ""}:${String(index)}`} className="codex-panel__output codex-panel__system-result-section">
          {section.title ? <div className="codex-panel__output-title">{section.title}</div> : null}
          <DetailSectionBody section={noticeDetailSection(section)} />
        </div>
      ))}
    </>
  );
}

export function userInputQuestionDetails(questions: readonly MessageStreamUserInputQuestionResult[]): TextItemDetailSection[] {
  return questions.map((question) => ({
    title: `Question: ${question.header}`,
    facts: [
      { key: "Prompt", value: question.question },
      ...(question.answer !== undefined ? [{ key: "Answer", value: question.answer }] : []),
    ],
  }));
}

interface TextItemDetailSection {
  title?: string;
  facts?: { key: string; value: string }[];
  body?: string;
}

function noticeDetailSection(section: MessageStreamNoticeSection): TextItemDetailSection {
  return {
    ...(section.title !== undefined ? { title: section.title } : {}),
    ...(section.auditFacts !== undefined ? { facts: section.auditFacts } : {}),
    ...(section.body !== undefined ? { body: section.body } : {}),
  };
}

function DetailSectionBody({ section }: { section: TextItemDetailSection }): UiNode {
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
