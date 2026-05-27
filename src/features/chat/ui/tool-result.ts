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
