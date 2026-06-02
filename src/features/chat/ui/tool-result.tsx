import type { ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { toolResultView, type ToolResultDetailSection, type ToolResultDisplayItem, type ToolResultView } from "../display/tool-view";
import { renderRawDiffLines } from "../../../shared/diff/render";

export interface ToolResultRenderContext {
  workspaceRoot?: string | null;
  openDetails: ReadonlySet<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
  renderTextWithWikiLinks: (parent: HTMLElement, text: string) => void;
}

export function toolResultNode(item: ToolResultDisplayItem, context: ToolResultRenderContext): UiNode {
  return <ToolResult item={item} context={context} />;
}

function ToolResult({ item, context }: { item: ToolResultDisplayItem; context: ToolResultRenderContext }): UiNode {
  const view = toolResultView(item, context.workspaceRoot);
  const [open, setOpen] = useState(context.openDetails.has(view.detailsKey));

  useLayoutEffect(() => {
    setOpen(context.openDetails.has(view.detailsKey));
  }, [context.openDetails, view.detailsKey]);

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
        <TextWithWikiLinks className="codex-panel__tool-summary" text={view.summary} context={context} />
      </div>
    );
  }

  return (
    <div className={className}>
      <details
        className="codex-panel__tool-result-details"
        open={open}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setOpen(nextOpen);
          context.onDetailsToggle?.(view.detailsKey, nextOpen);
        }}
      >
        <ToolResultHeader view={view} />
        {view.details.map((section, index) => (
          <ToolResultDetailSection key={`${section.kind}:${section.title ?? ""}:${String(index)}`} section={section} />
        ))}
      </details>
      <TextWithWikiLinks className="codex-panel__tool-summary" text={view.summary} context={context} />
    </div>
  );
}

function ToolResultHeader({ view }: { view: ToolResultView }): UiNode {
  const content = <span className="codex-panel__message-role codex-panel__tool-result-label">{view.label}</span>;
  return view.details.length > 0 ? (
    <summary className="codex-panel__tool-result-header">{content}</summary>
  ) : (
    <div className="codex-panel__tool-result-header">{content}</div>
  );
}

function TextWithWikiLinks({ className, text, context }: { className: string; text: string; context: ToolResultRenderContext }): UiNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef(context);
  useLayoutEffect(() => {
    contextRef.current = context;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    contextRef.current.renderTextWithWikiLinks(element, text);
  }, [text]);
  return <div ref={ref} className={className} />;
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

function MetaBlock({ title, rows }: { title: string | undefined; rows: { key: string; value: string }[] }): UiNode {
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
