import { MarkdownRenderer, type App, type Component } from "obsidian";

import { notifyMessageContentRendered } from "../message-content-events";
import { bindRenderedMarkdownFileLinks, bindRenderedWikiLinks } from "./rendered-markdown-links";

export interface MarkdownMessageRendererOptions {
  app: App;
  owner: Component;
  vaultPath: string;
  messagesPinnedToBottom: () => boolean;
  pinMessagesToBottom: (messagesEl: HTMLElement) => void;
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
