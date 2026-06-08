import { MarkdownRenderer, type App, type Component } from "obsidian";

import { notifyMessageContentRendered } from "../message-content-events";
import { bindRenderedMarkdownFileLinks, bindRenderedWikiLinks } from "./rendered-markdown-links";

export interface MarkdownMessageRendererOptions {
  app: App;
  owner: Component;
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
    });
  }
}
