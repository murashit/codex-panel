import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { toolResultView, type ToolResultDetailSection, type ToolResultDisplayItem, type ToolResultView } from "../display/tool-view";
import { createMetaPair } from "../../../shared/ui/components";
import { applyExecutionStateClass } from "./execution-state";
import { renderRawDiffLines } from "../../../shared/diff/render";

export interface ToolResultRenderContext {
  workspaceRoot?: string | null;
  openDetails: Set<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
  renderTextWithWikiLinks: (parent: HTMLElement, text: string) => void;
}

export function toolResultNode(item: ToolResultDisplayItem, context: ToolResultRenderContext): ReactNode {
  return <ToolResult item={item} context={context} />;
}

function ToolResult({ item, context }: { item: ToolResultDisplayItem; context: ToolResultRenderContext }): ReactNode {
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

function ToolResultHeader({ view }: { view: ToolResultView }): ReactNode {
  const content = <span className="codex-panel__message-role codex-panel__tool-result-label">{view.label}</span>;
  return view.details.length > 0 ? (
    <summary className="codex-panel__tool-result-header">{content}</summary>
  ) : (
    <div className="codex-panel__tool-result-header">{content}</div>
  );
}

function TextWithWikiLinks({ className, text, context }: { className: string; text: string; context: ToolResultRenderContext }): ReactNode {
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

function ToolResultDetailSection({ section }: { section: ToolResultDetailSection }): ReactNode {
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

function MetaBlock({ title, rows }: { title: string | undefined; rows: { key: string; value: string }[] }): ReactNode {
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

function FragmentPair({ row }: { row: { key: string; value: string } }): ReactNode {
  return (
    <>
      <dt>{row.key}</dt>
      <dd>{row.value}</dd>
    </>
  );
}

function OutputBlock({ title, body }: { title: string; body: string }): ReactNode {
  return (
    <OutputSection title={title} className="codex-panel__output">
      <pre>{body}</pre>
    </OutputSection>
  );
}

function OutputSection({ title, className, children }: { title: string; className: string; children: ReactNode }): ReactNode {
  return (
    <div className={className}>
      <div className="codex-panel__output-title">{title}</div>
      {children}
    </div>
  );
}

function DiffLines({ diff }: { diff: string }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    renderRawDiffLines(element, diff);
  }, [diff]);
  return <div ref={ref} />;
}

export function renderToolResult(parent: HTMLElement, item: ToolResultDisplayItem, context: ToolResultRenderContext): void {
  const view = toolResultView(item, context.workspaceRoot);
  const { root, detailsParent } = createToolResultContainer(parent, view, context);
  const messageEl = root;
  applyExecutionStateClass(messageEl, view.state);
  createToolResultHeader(messageEl, view);
  const content = messageEl.createDiv({ cls: "codex-panel__tool-summary" });
  context.renderTextWithWikiLinks(content, view.summary);

  for (const section of view.details) {
    renderDetailSection(detailsParent, section);
  }
}

function createToolResultContainer(
  parent: HTMLElement,
  view: ToolResultView,
  context: ToolResultRenderContext,
): { root: HTMLElement; detailsParent: HTMLElement } {
  if (view.details.length === 0) {
    const root = parent.createDiv({ cls: `${view.className} codex-panel__tool-result codex-panel__tool-result--plain` });
    return { root, detailsParent: root };
  }
  const root = parent.createDiv({ cls: `${view.className} codex-panel__tool-result` });
  const details = root.createEl("details", { cls: "codex-panel__tool-result-details" });
  details.open = context.openDetails.has(view.detailsKey);
  setToolResultOpenClass(root, details.open);
  details.ontoggle = () => {
    setToolResultOpenClass(root, details.open);
    context.onDetailsToggle?.(view.detailsKey, details.open);
  };
  return { root, detailsParent: details };
}

function setToolResultOpenClass(parent: HTMLElement, open: boolean): void {
  parent.classList.toggle("is-open", open);
}

function createToolResultHeader(parent: HTMLElement, view: ToolResultView): void {
  const target = parent.querySelector<HTMLElement>(":scope > .codex-panel__tool-result-details") ?? parent;
  const row =
    view.details.length > 0
      ? target.createEl("summary", { cls: "codex-panel__tool-result-header" })
      : target.createDiv({ cls: "codex-panel__tool-result-header" });
  row.createSpan({ cls: "codex-panel__message-role codex-panel__tool-result-label", text: view.label });
}

function renderDetailSection(parent: HTMLElement, section: ToolResultDetailSection): void {
  if (section.kind === "meta") {
    renderMetaBlock(parent, section.title, section.rows);
    return;
  }
  if (section.kind === "diff") {
    const diffBlock = renderOutputSection(parent, section.title, "codex-panel-diff-file");
    renderDiff(diffBlock, section.diff);
    return;
  }
  renderOutputBlock(parent, section.title, section.body);
}

function renderMetaBlock(parent: HTMLElement, title: string | undefined, rows: { key: string; value: string }[]): void {
  const section = title ? renderOutputSection(parent, title, "codex-panel__output codex-panel__output--meta") : parent;
  const meta = section.createEl("dl", { cls: "codex-panel__meta-grid" });
  for (const row of rows) {
    createMetaPair(meta, row.key, row.value);
  }
}

function renderOutputBlock(parent: HTMLElement, title: string, body: string): void {
  const section = renderOutputSection(parent, title, "codex-panel__output");
  section.createEl("pre", { text: body });
}

function renderOutputSection(parent: HTMLElement, title: string, className: string): HTMLElement {
  const section = parent.createDiv({ cls: className });
  section.createDiv({ cls: "codex-panel__output-title", text: title });
  return section;
}

function renderDiff(parent: HTMLElement, diff: string): void {
  renderRawDiffLines(parent, diff);
}
