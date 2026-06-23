import { MarkdownRenderer, Notice, type App, type Component } from "obsidian";
import { micromark } from "micromark";

import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "../../../../shared/obsidian/file-links";
import { notifyMessageContentRendered } from "./content-events";

interface MarkdownMessageRendererOptions {
  app: App;
  owner: Component;
  vaultPath: string;
}

interface StreamMarkdownRenderContext {
  app: App;
  vaultPath: string;
}

export class MarkdownMessageRenderer {
  private readonly renderGenerations = new WeakMap<HTMLElement, number>();

  constructor(private readonly options: MarkdownMessageRendererOptions) {}

  renderObsidianMarkdown(parent: HTMLElement, text: string): void {
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

export function renderStreamMarkdown(parent: HTMLElement, text: string, context: StreamMarkdownRenderContext): void {
  const html = micromark(text);
  const DOMParserConstructor = parent.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parser = new DOMParserConstructor();
  const parsed = parser.parseFromString(html, "text/html");
  const nodes = Array.from(parsed.body.childNodes).map((node) => parent.ownerDocument.importNode(node, true));
  parent.replaceChildren(...nodes);
  bindStreamMarkdownFileLinks(parent, context);
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

function bindStreamMarkdownFileLinks(parent: HTMLElement, context: StreamMarkdownRenderContext): void {
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
