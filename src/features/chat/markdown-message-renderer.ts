import { MarkdownRenderer, Notice, type App, type Component } from "obsidian";

import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "./markdown-file-links";
import { renderTextWithWikiLinks as renderInlineWikiLinks } from "../../shared/ui/dom";
import { notifyMessageContentRendered } from "./ui/message-content-events";

export interface MarkdownMessageRendererOptions {
  app: App;
  owner: Component;
  vaultPath: string;
  messagesPinnedToBottom: () => boolean;
  pinMessagesToBottom: (messagesEl: HTMLElement) => void;
}

export interface RenderedMarkdownLinkContext {
  app: App;
  vaultPath: string;
}

export class MarkdownMessageRenderer {
  constructor(private readonly options: MarkdownMessageRendererOptions) {}

  renderMarkdown(parent: HTMLElement, text: string): void {
    const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
    void MarkdownRenderer.render(this.options.app, text, parent, sourcePath, this.options.owner).then(() => {
      if (!parent.isConnected) return;
      bindRenderedWikiLinks(parent, sourcePath, this.options);
      bindRenderedMarkdownFileLinks(parent, sourcePath, this.options);
      notifyMessageContentRendered(parent);
      this.scrollMarkdownMessageIntoPinnedBottom(parent);
    });
  }

  renderTextWithWikiLinks(parent: HTMLElement, text: string): void {
    renderInlineWikiLinks(parent, text, (target) => {
      const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
      void this.options.app.workspace.openLinkText(target, sourcePath, false);
    });
  }

  private scrollMarkdownMessageIntoPinnedBottom(parent: HTMLElement): void {
    if (!this.options.messagesPinnedToBottom()) return;
    const messagesEl = parent.closest<HTMLElement>(".codex-panel__messages");
    if (!messagesEl) return;
    messagesEl.win.requestAnimationFrame(() => {
      if (!this.options.messagesPinnedToBottom()) return;
      this.options.pinMessagesToBottom(messagesEl);
    });
  }
}

export function bindRenderedWikiLinks(parent: HTMLElement, sourcePath: string, context: RenderedMarkdownLinkContext): void {
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

export function bindRenderedMarkdownFileLinks(parent: HTMLElement, sourcePath: string, context: RenderedMarkdownLinkContext): void {
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
