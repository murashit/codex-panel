import { micromark } from "micromark";
import { type App, type Component, MarkdownRenderer, Notice } from "obsidian";

import { isAbsoluteFileHref, vaultRelativeFileLinkTarget } from "../../../../domain/vault/file-hrefs";
import { vaultFileLinkTarget } from "../../../../shared/obsidian/vault-file-links.obsidian";
import { notifyMessageContentRendered } from "./content-rendered-event.dom";

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
      bindRenderedTags(parent, this.options);
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

function bindRenderedTags(parent: HTMLElement, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a.tag").forEach((link) => {
    link.onclick = (event) => {
      event.preventDefault();
      const tag = renderedTagName(link);
      if (!tag) return;
      void openTagSearch(context.app, tag);
    };
  });
}

function renderedTagName(link: HTMLAnchorElement): string | null {
  const text = link.textContent.trim();
  const value = text || link.getAttribute("data-tag") || link.getAttribute("href");
  if (!value) return null;
  const normalized = value.trim().replace(/^#*/, "");
  return normalized.length > 0 ? normalized : null;
}

async function openTagSearch(app: App, tag: string): Promise<void> {
  const leaf = app.workspace.getLeftLeaf(false);
  if (!leaf) {
    new Notice("Cannot open Obsidian search.");
    return;
  }
  await leaf.setViewState({
    type: "search",
    active: true,
    state: { query: `tag:#${tag}` },
  });
  await app.workspace.revealLeaf(leaf);
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
