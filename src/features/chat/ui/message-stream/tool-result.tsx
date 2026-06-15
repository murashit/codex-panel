import type { ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { type ToolResultDetailSection, type ToolResultView } from "../../presentation/message-stream/tool-result-view";
import { renderRawDiffLines } from "../../../../shared/diff/render";
import type { MessageStreamDisclosureState } from "./context";

export interface ToolResultRenderContext {
  disclosures: MessageStreamDisclosureState;
  onDisclosureToggle?: (bucket: "toolResults", id: string, open: boolean) => void;
}

export function toolResultNode(view: ToolResultView, context: ToolResultRenderContext): UiNode {
  return <ToolResult view={view} context={context} />;
}

function ToolResult({ view, context }: { view: ToolResultView; context: ToolResultRenderContext }): UiNode {
  const open = context.disclosures.toolResults.has(view.detailsKey);
  const hasSummary = view.summary.trim().length > 0;

  const className = [
    view.className,
    "codex-panel__tool-result",
    view.details.length === 0 ? "codex-panel__tool-result--plain" : "",
    view.state ? `codex-panel__execution codex-panel__execution--${view.state}` : "",
    open ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (view.details.length === 0) {
    return (
      <div className={className}>
        <ToolResultHeader view={view} />
        {hasSummary ? <ToolSummary text={view.summary} /> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <details
        className="codex-panel__tool-result-details"
        open={open}
        onToggle={(event) => {
          context.onDisclosureToggle?.("toolResults", view.detailsKey, event.currentTarget.open);
        }}
      >
        <ToolResultHeader view={view} />
        {view.details.map((section, index) => (
          <ToolResultDetailSection key={`${section.kind}:${section.title ?? ""}:${String(index)}`} section={section} />
        ))}
      </details>
      {hasSummary ? <ToolSummary text={view.summary} /> : null}
    </div>
  );
}

function ToolResultHeader({ view }: { view: ToolResultView }): UiNode {
  const content = <span className="codex-panel__message-role codex-panel__tool-result-label">{view.label}</span>;
  return view.details.length > 0 ? (
    <summary className="codex-panel__tool-result-header" tabIndex={-1}>
      {content}
    </summary>
  ) : (
    <div className="codex-panel__tool-result-header">{content}</div>
  );
}

function ToolSummary({ text }: { text: string }): UiNode {
  return <div className="codex-panel__tool-summary">{text}</div>;
}

function ToolResultDetailSection({ section }: { section: ToolResultDetailSection }): UiNode {
  if (section.kind === "meta") {
    return <MetaBlock title={section.title} rows={section.rows} />;
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

function MetaBlock({
  title,
  rows,
}: {
  title: string | undefined;
  rows: readonly { readonly key: string; readonly value: string }[];
}): UiNode {
  const body = (
    <dl className="codex-panel__meta-grid">
      {rows.map((row) => (
        <FragmentPair key={`${row.key}\n${row.value}`} row={row} />
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

function FragmentPair({ row }: { row: { key: string; value: string } }): UiNode {
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
