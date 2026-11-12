import { micromark } from "micromark";
import { type App, type Component, Keymap, MarkdownPreviewRenderer, MarkdownRenderer, Notice, parseLinktext } from "obsidian";
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
  private readonly renderRoots = new WeakSet<HTMLElement>();

  constructor(private readonly options: ThreadStreamMarkdownRendererOptions) {
    const postprocess = (element: HTMLElement): void => {
      if (!this.renderRoots.has(element)) return;
      // Run synchronously before native embed loading captures targets or adds nested previews.
      bindRenderedFileLinks(element, this.options);
      bindCodexThreadLinks(element, this.options);
      bindRenderedTags(element, this.options);
      prepareRenderedEmbeds(element, this.options);
    };
    MarkdownPreviewRenderer.registerPostProcessor(postprocess);
    options.owner.register(() => {
      MarkdownPreviewRenderer.unregisterPostProcessor(postprocess);
    });
  }

  renderObsidianMarkdown(parent: HTMLElement, text: string): void {
    const generation = (this.renderGenerations.get(parent) ?? 0) + 1;
    this.renderGenerations.set(parent, generation);
    const staging = parent.createDiv();
    staging.remove();
    this.renderRoots.add(staging);
    void MarkdownRenderer.render(this.options.app, text, staging, "", this.options.owner)
      .then(() => {
        if (!parent.isConnected || this.renderGenerations.get(parent) !== generation) return;
        parent.replaceChildren(...Array.from(staging.childNodes));
        notifyThreadStreamContentRendered(parent);
      })
      .catch((error: unknown) => {
        if (!parent.isConnected || this.renderGenerations.get(parent) !== generation) return;
        new Notice(`Failed to render Codex message: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.renderRoots.delete(staging);
      });
  }
}

export function renderStreamMarkdown(parent: HTMLElement, text: string): void {
  // Keep links and images inert before even parsing HTML into a temporary document.
  const html = micromark(text, { extensions: [{ disable: { null: ["labelStartLink", "labelStartImage", "autolink"] } }] });
  const DOMParserConstructor = parent.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parser = new DOMParserConstructor();
  const parsed = parser.parseFromString(html, "text/html");
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

function internalFileTarget(context: RenderedMarkdownLinkContext, href: string): string | null {
  const parsed = parseLinktext(href);
  if (!isFilesystemAbsolutePath(parsed.path)) return href;
  const path = vaultRelativePath(context.vaultPath, parsed.path);
  return path === null || isVaultConfigPath(path, context.app.vault.configDir, context.vaultPath) ? null : `${path}${parsed.subpath}`;
}

function prepareRenderedEmbeds(parent: HTMLElement, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLElement>(".internal-embed:not(.is-loaded)[src]").forEach((embed) => {
    const href = embed.getAttribute("src") ?? "";
    const target = internalFileTarget(context, href);
    if (target !== null) {
      embed.setAttribute("src", target);
      return;
    }
    const blocked = parent.createSpan({
      text: `Cannot embed this file: ${embed.getAttribute("alt") || href}`,
      attr: { title: href },
    });
    embed.replaceWith(blocked);
  });
}

function bindRenderedFileLinks(parent: HTMLElement, context: RenderedMarkdownLinkContext): void {
  parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
    link.addClass("codex-panel__wikilink");
    const open = (event: MouseEvent): void => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent;
      if (!href.trim()) return;
      const target = internalFileTarget(context, href);
      if (target === null) {
        new Notice("Cannot open files outside the vault.");
        return;
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
