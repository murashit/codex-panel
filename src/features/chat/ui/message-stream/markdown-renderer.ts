import { MarkdownRenderer, Notice, type App, type Component } from "obsidian";

import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "../../../../shared/obsidian/file-links";
import { notifyMessageContentRendered } from "./content-events";

export interface MarkdownMessageRendererOptions {
  app: App;
  owner: Component;
  vaultPath: string;
}

export class MarkdownMessageRenderer {
  private readonly renderGenerations = new WeakMap<HTMLElement, number>();

  constructor(private readonly options: MarkdownMessageRendererOptions) {}

  renderMarkdown(parent: HTMLElement, text: string): void {
    const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
    const generation = (this.renderGenerations.get(parent) ?? 0) + 1;
    this.renderGenerations.set(parent, generation);
    const staging = parent.ownerDocument.createElement("div");
    void MarkdownRenderer.render(this.options.app, text, staging, sourcePath, this.options.owner).then(() => {
      if (!parent.isConnected || this.renderGenerations.get(parent) !== generation) return;
      parent.replaceChildren(...Array.from(staging.childNodes));
      bindRenderedWikiLinks(parent, sourcePath, this.options);
      bindRenderedMarkdownFileLinks(parent, sourcePath, this.options);
      notifyMessageContentRendered(parent);
    });
  }
}

interface RenderedMarkdownLinkContext {
  app: App;
  vaultPath: string;
}

function bindRenderedWikiLinks(parent: HTMLElement, sourcePath: string, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
    link.addClass("codex-panel__wikilink");
    link.onclick = (event) => {
      event.preventDefault();
      const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent;
      const target = vaultRelativeFileLinkTarget(context.vaultPath, context.app.vault.configDir, href) ?? href;
      if (target === href && isAbsoluteFileHref(href)) {
        new Notice("Cannot open files outside the vault.");
        return;
      }
      if (target.trim().length > 0) {
        void context.app.workspace.openLinkText(target, sourcePath, false);
      }
    };
  });
}

function bindRenderedMarkdownFileLinks(parent: HTMLElement, sourcePath: string, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a[href]:not(.internal-link)").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    const target = vaultFileLinkTarget(context.app, context.vaultPath, href);
    if (!target) return;

    link.addClass("codex-panel__filelink");
    link.onclick = (event) => {
      event.preventDefault();
      void context.app.workspace.openLinkText(target, sourcePath, false);
    };
  });
}
