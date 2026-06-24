import type { ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { renderRawDiffLines } from "../../../../shared/diff/render";
import type { DetailSection, DetailView } from "../../presentation/message-stream/detail-view";
import type { MessageStreamDisclosureState } from "./context";

export interface DetailRenderContext {
  disclosures: MessageStreamDisclosureState;
  onDisclosureToggle?: (bucket: "details", id: string, open: boolean) => void;
}

export function detailNode(view: DetailView, context: DetailRenderContext): UiNode {
  return <Detail view={view} context={context} />;
}

function Detail({ view, context }: { view: DetailView; context: DetailRenderContext }): UiNode {
  const open = context.disclosures.details.has(view.detailsKey);
  const hasSummary = view.summary.trim().length > 0;

  const className = [
    view.className,
    "codex-panel__detail",
    view.sections.length === 0 ? "codex-panel__detail--plain" : "",
    executionClassName(view.state),
    open ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (view.sections.length === 0) {
    return (
      <div className={className}>
        <DetailHeader view={view} />
        {hasSummary ? <DetailSummary text={view.summary} /> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <details
        className="codex-panel__detail-disclosure"
        open={open}
        onToggle={(event) => {
          context.onDisclosureToggle?.("details", view.detailsKey, event.currentTarget.open);
        }}
      >
        <DetailHeader view={view} />
        {view.sections.map((section, index) => (
          <DetailSectionView key={`${section.kind}:${section.title ?? ""}:${String(index)}`} section={section} />
        ))}
      </details>
      {hasSummary ? <DetailSummary text={view.summary} /> : null}
    </div>
  );
}

function executionClassName(state: DetailView["state"]): string {
  if (state === "completed") return "codex-panel__execution codex-panel__execution--completed";
  if (state === "failed") return "codex-panel__execution codex-panel__execution--failed";
  if (state === "running") return "codex-panel__execution codex-panel__execution--running";
  return "";
}

function DetailHeader({ view }: { view: DetailView }): UiNode {
  const content = <span className="codex-panel__message-role codex-panel__detail-label">{view.label}</span>;
  return view.sections.length > 0 ? (
    <summary className="codex-panel__detail-header" tabIndex={-1}>
      {content}
    </summary>
  ) : (
    <div className="codex-panel__detail-header">{content}</div>
  );
}

function DetailSummary({ text }: { text: string }): UiNode {
  return <div className="codex-panel__stream-summary">{text}</div>;
}

function DetailSectionView({ section }: { section: DetailSection }): UiNode {
  if (section.kind === "kv") {
    return <KeyValueBlock title={section.title} rows={section.rows} />;
  }
  if (section.kind === "diff") {
    return (
      <OutputSection title={section.title} className="codex-panel-diff-file">
        <DiffLines diff={section.diff} />
      </OutputSection>
    );
  }
  return <OutputBlock title={section.title} body={section.body} />;
}

function KeyValueBlock({
  title,
  rows,
}: {
  title: string | undefined;
  rows: readonly { readonly key: string; readonly value: string }[];
}): UiNode {
  const body = (
    <dl className="codex-panel__meta-grid">
      {rows.map((row) => (
        <KeyValuePair key={`${row.key}\n${row.value}`} row={row} />
      ))}
    </dl>
  );
  return title ? (
    <OutputSection title={title} className="codex-panel__output codex-panel__output--meta">
      {body}
    </OutputSection>
  ) : (
    body
  );
}

function KeyValuePair({ row }: { row: { key: string; value: string } }): UiNode {
  return (
    <>
      <dt>{row.key}</dt>
      <dd>{row.value}</dd>
    </>
  );
}

function OutputBlock({ title, body }: { title: string; body: string }): UiNode {
  return (
    <OutputSection title={title} className="codex-panel__output">
      <pre>{body}</pre>
    </OutputSection>
  );
}

function OutputSection({ title, className, children }: { title: string; className: string; children: UiNode }): UiNode {
  return (
    <div className={className}>
      <div className="codex-panel__output-title">{title}</div>
      {children}
    </div>
  );
}

function DiffLines({ diff }: { diff: string }): UiNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    renderRawDiffLines(element, diff);
  }, [diff]);
  return <div ref={ref} />;
}
