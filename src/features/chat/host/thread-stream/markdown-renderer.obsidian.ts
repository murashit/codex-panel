import { fromMarkdown } from "mdast-util-from-markdown";
import { micromark } from "micromark";
import { type App, type Component, Keymap, MarkdownRenderer, Notice, parseLinktext } from "obsidian";
import { visit } from "unist-util-visit";
import { isFilesystemAbsolutePath, isVaultConfigPath, vaultRelativePath } from "../../../../domain/files/paths";
import { codexThreadIdFromHref } from "../../../../domain/threads/links";
import { notifyThreadStreamContentRendered } from "../../ui/thread-stream/content-rendered-event.dom";

interface ThreadStreamMarkdownRendererOptions {
  app: App;
  owner: Component;
  vaultPath: string;
  openThread: (threadId: string) => void;
}

interface ObsidianGlobalSearchPlugin {
  openGlobalSearch?: (query: string, active?: boolean) => void;
}

interface ObsidianAppWithInternalPlugins extends App {
  internalPlugins?: {
    plugins?: {
      "global-search"?: {
        instance?: ObsidianGlobalSearchPlugin;
      };
    };
  };
}

export class ThreadStreamMarkdownRenderer {
  private readonly renderGenerations = new WeakMap<HTMLElement, number>();

  constructor(private readonly options: ThreadStreamMarkdownRendererOptions) {}

  renderObsidianMarkdown(parent: HTMLElement, text: string): void {
    const generation = (this.renderGenerations.get(parent) ?? 0) + 1;
    this.renderGenerations.set(parent, generation);
    const staging = parent.createDiv();
    staging.remove();
    void MarkdownRenderer.render(this.options.app, markWikilinks(text), staging, "", this.options.owner)
      .then(() => {
        if (!parent.isConnected || this.renderGenerations.get(parent) !== generation) return;
        parent.replaceChildren(...Array.from(staging.childNodes));
        bindRenderedFileLinks(parent, this.options);
        bindCodexThreadLinks(parent, this.options);
        bindRenderedTags(parent, this.options);
        notifyThreadStreamContentRendered(parent);
      })
      .catch((error: unknown) => {
        if (!parent.isConnected || this.renderGenerations.get(parent) !== generation) return;
        new Notice(`Failed to render Codex message: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
}

export function renderStreamMarkdown(parent: HTMLElement, text: string): void {
  const html = micromark(text);
  const DOMParserConstructor = parent.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parser = new DOMParserConstructor();
  const parsed = parser.parseFromString(html, "text/html");
  parsed.body.querySelectorAll("a").forEach((link) => {
    link.replaceWith(...Array.from(link.childNodes));
  });
  const nodes = Array.from(parsed.body.childNodes).map((node) => parent.ownerDocument.importNode(node, true));
  parent.replaceChildren(...nodes);
}

interface RenderedMarkdownLinkContext {
  app: App;
  vaultPath: string;
}

interface CodexThreadLinkContext {
  openThread: (threadId: string) => void;
}

// Obsidian renders both wiki and Markdown links as a.internal-link. Mark the
// source syntax so only wikilinks receive Panel's absolute-path policy.
function markWikilinks(markdown: string): string {
  if (!markdown.includes("[[")) return markdown;
  const excluded: { start: number; end: number }[] = [];
  visit(fromMarkdown(markdown), (node) => {
    if (node.type === "link" || node.type === "linkReference") {
      const sourceStart = node.position?.start.offset;
      const start = sourceStart !== undefined && markdown[sourceStart] === "<" ? sourceStart : node.children.at(-1)?.position?.end.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) excluded.push({ start, end });
      return;
    }
    if (!["code", "inlineCode", "image", "imageReference", "definition", "html"].includes(node.type)) return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) excluded.push({ start, end });
  });
  const escaped = (offset: number): boolean => {
    let backslashes = 0;
    while (markdown[offset - backslashes - 1] === "\\") backslashes += 1;
    return backslashes % 2 === 1;
  };
  return markdown.replace(/\[\[((?:(?!\[\[).)+?)\]\]/g, (wiki: string, _target: string, offset: number) => {
    if (escaped(offset) || (markdown[offset - 1] === "!" && !escaped(offset - 1))) return wiki;
    if (excluded.some((range) => range.start <= offset && range.end >= offset + wiki.length)) return wiki;
    return `<span data-codex-panel-wikilink>${wiki}</span>`;
  });
}

function bindRenderedFileLinks(parent: HTMLElement, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
    const wikilink = link.parentElement?.hasAttribute("data-codex-panel-wikilink") === true;
    if (wikilink) link.addClass("codex-panel__wikilink");
    const open = (event: MouseEvent): void => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent;
      if (!href.trim()) return;
      const parsed = parseLinktext(href);
      let target = href;
      if (wikilink && isFilesystemAbsolutePath(parsed.path)) {
        const path = vaultRelativePath(context.vaultPath, parsed.path);
        if (path === null || isVaultConfigPath(path, context.app.vault.configDir, context.vaultPath)) {
          new Notice("Cannot open files outside the vault.");
          return;
        }
        target = `${path}${parsed.subpath}`;
      }
      void context.app.workspace.openLinkText(target, "", Keymap.isModEvent(event));
    };
    link.onclick = open;
    link.onauxclick = open;
  });
  parent.querySelectorAll<HTMLAnchorElement>("a.external-link").forEach((link) => {
    link.onclick = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href) link.ownerDocument.defaultView?.open(href, String(Keymap.isModEvent(event) || ""));
    };
  });
  parent.querySelectorAll("span[data-codex-panel-wikilink]").forEach((marker) => {
    marker.replaceWith(...Array.from(marker.childNodes));
  });
}

function bindRenderedTags(parent: HTMLElement, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a.tag").forEach((link) => {
    link.onclick = (event) => {
      event.preventDefault();
      const tag = renderedTagName(link);
      if (!tag) return;
      openTagSearch(context.app, tag);
    };
  });
}

function bindCodexThreadLinks(parent: HTMLElement, context: CodexThreadLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>('a[href^="codex://threads/"]').forEach((link) => {
    const threadId = codexThreadIdFromHref(link.getAttribute("href") ?? "");
    if (!threadId) return;
    link.addClass("codex-panel__thread-link");
    link.onclick = (event) => {
      event.preventDefault();
      context.openThread(threadId);
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

function openTagSearch(app: App, tag: string): void {
  const query = `tag:#${tag}`;
  const searchPlugin = (app as ObsidianAppWithInternalPlugins).internalPlugins?.plugins?.["global-search"]?.instance;
  if (typeof searchPlugin?.openGlobalSearch !== "function") {
    new Notice("Cannot open Obsidian search.");
    return;
  }
  searchPlugin.openGlobalSearch(query, true);
}
