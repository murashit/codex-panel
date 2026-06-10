import { MarkdownRenderer, type App, type Component } from "obsidian";

import { notifyMessageContentRendered } from "../message-content-events";
import { bindRenderedMarkdownFileLinks, bindRenderedWikiLinks } from "./rendered-markdown-links";

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
