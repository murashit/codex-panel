import { MarkdownRenderer, type App, type Component } from "obsidian";

import type { DisplayItem } from "../display/types";
import { copyTextWithNotice } from "../ui/clipboard";
import { renderTextWithWikiLinks as renderInlineWikiLinks } from "../ui/dom";
import { messageRenderBlocks, notifyMessageContentRendered, syncMessageRenderBlocks } from "../ui/message-stream";
import { bottomScrollTop, captureScrollAnchor, isNearScrollBottom, restoreScrollAnchor } from "../ui/scroll";
import type { TurnDiffViewState } from "../ui/turn-diff";
import { markdownFileLinkTarget } from "./markdown-file-links";
import { isRollbackCandidateItem, rollbackCandidateFromItems } from "./rollback";
import type { PanelState } from "./state";

export interface PanelMessageRendererOptions {
  app: App;
  owner: Component;
  state: PanelState;
  vaultPath: string;
  blockSignatures: Map<string, string>;
  consumeForceScrollToBottom: () => boolean;
  loadOlderTurns: () => void;
  rollbackThread: (threadId: string) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: TurnDiffViewState) => void;
  pendingRequestsSignature: () => string;
  renderPendingRequests: () => HTMLElement | null;
}

export class PanelMessageRenderer {
  constructor(private readonly options: PanelMessageRendererOptions) {}

  render(parent: HTMLElement): void {
    const { state } = this.options;
    const messagesEl = parent.querySelector<HTMLElement>(".codex-panel__messages") ?? parent.createDiv({ cls: "codex-panel__messages" });
    messagesEl.onscroll = () => {
      state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    };
    const wasNearBottom = isNearScrollBottom(messagesEl);
    const shouldScrollToBottom = this.options.consumeForceScrollToBottom() || wasNearBottom;
    const scrollAnchor = shouldScrollToBottom ? null : captureScrollAnchor(messagesEl);
    state.messagesPinnedToBottom = shouldScrollToBottom;
    const rollbackCandidate = state.busy ? null : rollbackCandidateFromItems(state.displayItems);
    const implementPlanCandidate = implementPlanCandidateFromState(state);

    const blocks = messageRenderBlocks({
      activeThreadId: state.activeThreadId,
      activeTurnId: state.activeTurnId,
      historyCursor: state.historyCursor,
      loadingHistory: state.loadingHistory,
      busy: state.busy,
      displayItems: state.displayItems,
      turnDiffs: state.turnDiffs,
      workspaceRoot: state.activeThreadCwd ?? this.options.vaultPath,
      openDetails: state.openDetails,
      onDetailsToggle: () => {
        messagesEl.win.requestAnimationFrame(() => {
          state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
        });
      },
      loadOlderTurns: () => this.options.loadOlderTurns(),
      renderMarkdown: (element, text) => this.renderMarkdownMessage(element, text),
      renderTextWithWikiLinks: (element, text) => this.renderTextWithWikiLinks(element, text),
      copyText: (text) => void this.copyMessageText(text),
      canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
      onImplementPlanItem: (item) => this.options.implementPlan(item),
      canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
      onRollbackItem: () => {
        if (state.activeThreadId) this.options.rollbackThread(state.activeThreadId);
      },
      openTurnDiff: (turnDiffState) => this.options.openTurnDiff(turnDiffState),
      pendingRequestsSignature: this.options.pendingRequestsSignature(),
      renderPendingRequests: () => this.options.renderPendingRequests(),
    });
    syncMessageRenderBlocks(messagesEl, blocks, this.options.blockSignatures);

    messagesEl.win.requestAnimationFrame(() => {
      if (shouldScrollToBottom) {
        messagesEl.scrollTop = bottomScrollTop(messagesEl);
      } else {
        restoreScrollAnchor(messagesEl, scrollAnchor);
      }
      state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    });
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
    void MarkdownRenderer.render(this.options.app, text, parent, sourcePath, this.options.owner).then(() => {
      this.bindRenderedWikiLinks(parent, sourcePath);
      this.bindRenderedMarkdownFileLinks(parent, sourcePath);
      notifyMessageContentRendered(parent);
      this.scrollMarkdownMessageIntoPinnedBottom(parent);
    });
  }

  private scrollMarkdownMessageIntoPinnedBottom(parent: HTMLElement): void {
    if (!this.options.state.messagesPinnedToBottom) return;
    const messagesEl = parent.closest<HTMLElement>(".codex-panel__messages");
    if (!messagesEl) return;
    messagesEl.win.requestAnimationFrame(() => {
      if (!this.options.state.messagesPinnedToBottom) return;
      messagesEl.scrollTop = bottomScrollTop(messagesEl);
      this.options.state.messagesPinnedToBottom = isNearScrollBottom(messagesEl);
    });
  }

  private bindRenderedWikiLinks(parent: HTMLElement, sourcePath: string): void {
    parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
      link.addClass("codex-panel__wikilink");
      link.onclick = (event) => {
        event.preventDefault();
        const target = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent ?? "";
        if (target.trim().length > 0) {
          void this.options.app.workspace.openLinkText(target, sourcePath, false);
        }
      };
    });
  }

  private bindRenderedMarkdownFileLinks(parent: HTMLElement, sourcePath: string): void {
    parent.querySelectorAll<HTMLAnchorElement>("a[href]:not(.internal-link)").forEach((link) => {
      const href = link.getAttribute("href") ?? "";
      const target = markdownFileLinkTarget(this.options.app, this.options.vaultPath, href);
      if (!target) return;

      link.addClass("codex-panel__filelink");
      link.onclick = (event) => {
        event.preventDefault();
        void this.options.app.workspace.openLinkText(target, sourcePath, false);
      };
    });
  }

  private renderTextWithWikiLinks(parent: HTMLElement, text: string): void {
    renderInlineWikiLinks(parent, text, (target) => {
      const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
      void this.options.app.workspace.openLinkText(target, sourcePath, false);
    });
  }
}

export function implementPlanCandidateFromState(
  state: Pick<PanelState, "activeThreadId" | "busy" | "composerDraft" | "requestedCollaborationMode" | "displayItems">,
): DisplayItem | null {
  if (!state.activeThreadId || state.busy || state.composerDraft.trim().length > 0 || state.requestedCollaborationMode !== "plan") {
    return null;
  }
  return (
    [...state.displayItems].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ??
    null
  );
}
