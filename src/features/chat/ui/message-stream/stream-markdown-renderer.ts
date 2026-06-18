import { Notice, type App } from "obsidian";
import { micromark } from "micromark";

import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "../../../../shared/obsidian/file-links";

export interface StreamMarkdownMessageRendererOptions {
  app: App;
  vaultPath: string;
}

export class StreamMarkdownMessageRenderer {
  constructor(private readonly options: StreamMarkdownMessageRendererOptions) {}

  renderStreamMarkdown(parent: HTMLElement, text: string): void {
    const html = micromark(text);
    const DOMParserConstructor = parent.ownerDocument.defaultView?.DOMParser ?? DOMParser;
    const parser = new DOMParserConstructor();
    const parsed = parser.parseFromString(html, "text/html");
    const nodes = Array.from(parsed.body.childNodes).map((node) => parent.ownerDocument.importNode(node, true));
    parent.replaceChildren(...nodes);
    bindStreamMarkdownFileLinks(parent, this.options);
  }
}

function bindStreamMarkdownFileLinks(parent: HTMLElement, context: StreamMarkdownMessageRendererOptions): void {
  const sourcePath = context.app.workspace.getActiveFile()?.path ?? "";
  parent.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    const target = vaultFileLinkTarget(context.app, context.vaultPath, href);
    if (target) {
      link.addClass("codex-panel__filelink");
      link.onclick = (event) => {
        event.preventDefault();
        void context.app.workspace.openLinkText(target, sourcePath, false);
      };
      return;
    }

    const vaultRelativeTarget = vaultRelativeFileLinkTarget(context.vaultPath, context.app.vault.configDir, href);
    if (vaultRelativeTarget) {
      link.onclick = (event) => {
        event.preventDefault();
      };
      return;
    }

    if (!isAbsoluteFileHref(href)) return;
    link.onclick = (event) => {
      event.preventDefault();
      new Notice("Cannot open files outside the vault.");
    };
  });
}
