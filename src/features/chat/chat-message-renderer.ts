import { MarkdownRenderer, Notice, type App, type Component } from "obsidian";
import type { ReactNode } from "react";

import type { DisplayItem } from "./display/types";
import { copyTextWithNotice } from "../../shared/ui/clipboard";
import { renderTextWithWikiLinks as renderInlineWikiLinks } from "../../shared/ui/dom";
import { messageRenderBlocks, notifyMessageContentRendered, renderMessageRenderBlocks } from "./ui/message-stream";
import { bottomScrollTop, captureScrollAnchor, isNearScrollBottom, restoreScrollAnchor } from "./ui/scroll";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";
import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "./markdown-file-links";
import { isRollbackCandidateItem, rollbackCandidateFromItems } from "./rollback";
import type { ChatAction, ChatState, ChatStateStore } from "./chat-state";
import { unmountReactRoot } from "../../shared/ui/react-root";

export interface ChatMessageRendererOptions {
  app: App;
  owner: Component;
  stateStore: ChatStateStore;
  vaultPath: string;
  blockSignatures: Map<string, string>;
  consumeScrollIntent: () => ChatMessageScrollIntent;
  loadOlderTurns: () => void;
  rollbackThread: (threadId: string) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature: () => string;
  renderPendingRequests: () => ReactNode;
}

export type ChatMessageScrollIntent = "auto" | "force-bottom" | "preserve";

export class ChatMessageRenderer {
  private renderGeneration = 0;
  private messagesEl: HTMLElement | null = null;

  constructor(private readonly options: ChatMessageRendererOptions) {}

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  render(parent: HTMLElement): void {
    const generation = ++this.renderGeneration;
    const state = this.state;
    const messagesEl = parent.querySelector<HTMLElement>(".codex-panel__messages") ?? parent.createDiv({ cls: "codex-panel__messages" });
    this.messagesEl = messagesEl;
    messagesEl.onscroll = () => {
      this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
    };
    const scrollIntent = this.options.consumeScrollIntent();
    const shouldPreserveScroll = scrollIntent === "preserve";
    const wasNearBottom = shouldPreserveScroll ? false : isNearScrollBottom(messagesEl);
    const shouldScrollToBottom =
      !shouldPreserveScroll && (scrollIntent === "force-bottom" || state.messagesPinnedToBottom || wasNearBottom);
    const scrollAnchor = shouldScrollToBottom ? null : captureScrollAnchor(messagesEl);
    this.dispatch({ type: "ui/messages-pinned-set", pinned: shouldScrollToBottom });
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
      onDetailsToggle: (key, open) => {
        this.setOpenDetail(key, open);
        messagesEl.win.requestAnimationFrame(() => {
          this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
        });
      },
      loadOlderTurns: () => {
        this.options.loadOlderTurns();
      },
      renderMarkdown: (element, text) => {
        this.renderMarkdownMessage(element, text);
      },
      renderTextWithWikiLinks: (element, text) => {
        this.renderTextWithWikiLinks(element, text);
      },
      copyText: (text) => void this.copyMessageText(text),
      canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
      onImplementPlanItem: (item) => {
        this.options.implementPlan(item);
      },
      canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
      onRollbackItem: () => {
        if (state.activeThreadId) this.options.rollbackThread(state.activeThreadId);
      },
      openTurnDiff: (turnDiffState) => {
        this.options.openTurnDiff(turnDiffState);
      },
      pendingRequestsSignature: this.options.pendingRequestsSignature(),
      renderPendingRequests: () => this.options.renderPendingRequests(),
    });
    renderMessageRenderBlocks(messagesEl, blocks, this.options.blockSignatures);

    messagesEl.win.requestAnimationFrame(() => {
      if (generation !== this.renderGeneration) return;
      if (shouldScrollToBottom) {
        if (!this.state.messagesPinnedToBottom) return;
        this.pinMessagesToBottom(messagesEl);
      } else {
        restoreScrollAnchor(messagesEl, scrollAnchor);
        this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
      }
    });
  }

  dispose(): void {
    this.renderGeneration += 1;
    if (this.messagesEl) {
      this.messagesEl.onscroll = null;
      unmountReactRoot(this.messagesEl);
    }
    this.messagesEl = null;
    this.options.blockSignatures.clear();
  }

  private async copyMessageText(text: string): Promise<void> {
    await copyTextWithNotice(text, "Copied message.", "Could not copy message.");
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
    void MarkdownRenderer.render(this.options.app, text, parent, sourcePath, this.options.owner).then(() => {
      if (!parent.isConnected) return;
      this.bindRenderedWikiLinks(parent, sourcePath);
      this.bindRenderedMarkdownFileLinks(parent, sourcePath);
      notifyMessageContentRendered(parent);
      this.scrollMarkdownMessageIntoPinnedBottom(parent);
    });
  }

  private scrollMarkdownMessageIntoPinnedBottom(parent: HTMLElement): void {
    if (!this.state.messagesPinnedToBottom) return;
    const messagesEl = parent.closest<HTMLElement>(".codex-panel__messages");
    if (!messagesEl) return;
    messagesEl.win.requestAnimationFrame(() => {
      if (!this.state.messagesPinnedToBottom) return;
      this.pinMessagesToBottom(messagesEl);
    });
  }

  private pinMessagesToBottom(messagesEl: HTMLElement): void {
    messagesEl.scrollTop = bottomScrollTop(messagesEl);
    this.dispatch({ type: "ui/messages-pinned-set", pinned: isNearScrollBottom(messagesEl) });
  }

  private setOpenDetail(key: string, open: boolean): void {
    this.dispatch({ type: "ui/detail-open-set", key, open });
  }

  private bindRenderedWikiLinks(parent: HTMLElement, sourcePath: string): void {
    parent.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
      link.addClass("codex-panel__wikilink");
      link.onclick = (event) => {
        event.preventDefault();
        const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent;
        const target = vaultRelativeFileLinkTarget(this.options.vaultPath, this.options.app.vault.configDir, href) ?? href;
        if (target === href && isAbsoluteFileHref(href)) {
          new Notice("Cannot open files outside the vault.");
          return;
        }
        if (target.trim().length > 0) {
          void this.options.app.workspace.openLinkText(target, sourcePath, false);
        }
      };
    });
  }

  private bindRenderedMarkdownFileLinks(parent: HTMLElement, sourcePath: string): void {
    parent.querySelectorAll<HTMLAnchorElement>("a[href]:not(.internal-link)").forEach((link) => {
      const href = link.getAttribute("href") ?? "";
      const target = vaultFileLinkTarget(this.options.app, this.options.vaultPath, href);
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
  state: Pick<ChatState, "activeThreadId" | "busy" | "composerDraft" | "requestedCollaborationMode" | "displayItems">,
): DisplayItem | null {
  if (!state.activeThreadId || state.busy || state.composerDraft.trim().length > 0 || state.requestedCollaborationMode !== "plan") {
    return null;
  }
  return (
    [...state.displayItems].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ??
    null
  );
}
