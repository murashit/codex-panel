import { displayBlocksForItems } from "../display/blocks";
import { displayItemSignature, isMessageCopyActionVisible } from "../display/signature";
import { executionState } from "../display/state";
import type { DisplayBlock, DisplayDetailSection, DisplayItem } from "../display/types";
import { createIconButton, createMetaPair, createRememberedDetails } from "../../../shared/ui/components";
import { shortSignature } from "../../../shared/ui/dom";
import { applyExecutionStateClass } from "./execution-state";
import { renderToolResult } from "./tool-result";
import {
  activeAgentRunSummaryBlock,
  createAgentRunSummaryElement,
  renderAgentItem,
  renderReasoningItem,
  renderTaskProgressItem,
} from "./work-items";
import type { ChatTurnDiffViewState } from "./turn-diff";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;
const MESSAGE_CONTENT_RENDERED_EVENT = "codex-panel:message-content-rendered";

export interface MessageRenderBlock {
  key: string;
  signature: string;
  render: () => HTMLElement;
}

export interface MessageStreamContext {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  busy: boolean;
  displayItems: DisplayItem[];
  turnDiffs?: ReadonlyMap<string, string>;
  workspaceRoot?: string | null;
  openDetails: Set<string>;
  onDetailsToggle?: () => void;
  loadOlderTurns: () => void;
  renderMarkdown: (parent: HTMLElement, text: string) => void;
  renderTextWithWikiLinks: (parent: HTMLElement, text: string) => void;
  copyText?: (text: string) => void;
  canImplementPlanItem?: (item: DisplayItem) => boolean;
  onImplementPlanItem?: (item: DisplayItem) => void;
  canRollbackItem?: (item: DisplayItem) => boolean;
  onRollbackItem?: (item: DisplayItem) => void;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature?: string;
  renderPendingRequests?: () => HTMLElement | null;
}

type RenderableMessageItem = Extract<DisplayItem, { kind: "message" | "system" | "userInputResult" }>;

function isRenderableMessageItem(item: DisplayItem): item is RenderableMessageItem {
  return item.kind === "message" || item.kind === "system" || item.kind === "userInputResult";
}

export function messageRenderBlocks(context: MessageStreamContext): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      signature: `${context.activeThreadId}:${context.historyCursor}:${String(context.loadingHistory)}`,
      render: () => createHistoryBarElement(context.loadingHistory, context.loadOlderTurns),
    });
  }

  if (context.displayItems.length === 0) {
    blocks.push({
      key: "empty",
      signature: "empty",
      render: () =>
        createDiv({
          cls: "codex-panel__message codex-panel__message--system",
          text: "Send a message to start a new thread.",
        }),
    });
    return blocks;
  }

  for (const block of displayBlocksForItems(context.displayItems, context.activeTurnId, context.workspaceRoot, context.turnDiffs)) {
    if (block.type === "item") {
      blocks.push({
        key: `item:${block.item.id}`,
        signature: displayItemSignature(block.item, context),
        render: () => createDisplayItemElement(block.item, context),
      });
    } else {
      blocks.push({
        key: `activity:${block.id}`,
        signature: `${block.summary}\n${block.items.map((item) => displayItemSignature(item, context)).join("\n")}`,
        render: () => createActivityGroupElement(block, context),
      });
    }
  }

  const agentSummary = activeAgentRunSummaryBlock(context);
  if (agentSummary) {
    blocks.push({
      key: `active-agents:${context.activeTurnId ?? "none"}`,
      signature: JSON.stringify(agentSummary),
      render: () => createAgentRunSummaryElement(agentSummary),
    });
  }

  if (context.renderPendingRequests && context.pendingRequestsSignature) {
    blocks.push({
      key: "pending-requests",
      signature: context.pendingRequestsSignature,
      render: () => context.renderPendingRequests?.() ?? createDiv(),
    });
  }

  return blocks;
}

export function syncMessageRenderBlocks(parent: HTMLElement, blocks: MessageRenderBlock[], signatures: Map<string, string>): void {
  const existing = new Map<string, HTMLElement>();
  parent.querySelectorAll<HTMLElement>(":scope > [data-codex-panel-block-key]").forEach((element) => {
    const key = element.dataset["codexPanelBlockKey"];
    if (key) existing.set(key, element);
  });

  const seen = new Set<string>();
  let nextPosition: ChildNode | null = parent.firstChild;
  for (const block of blocks) {
    const current = existing.get(block.key);
    let element = current;
    const currentWasNext = current === nextPosition;
    if (!element || signatures.get(block.key) !== block.signature) {
      element = block.render();
      element.dataset["codexPanelBlockKey"] = block.key;
      element.dataset["codexPanelBlockSignature"] = shortSignature(block.signature);
      signatures.set(block.key, block.signature);
      if (current) {
        current.replaceWith(element);
        if (currentWasNext) nextPosition = element;
      }
    }
    if (element !== nextPosition) {
      parent.insertBefore(element, nextPosition);
    }
    nextPosition = element.nextSibling;
    seen.add(block.key);
  }

  for (const [key, element] of existing) {
    if (!seen.has(key)) {
      signatures.delete(key);
      element.remove();
    }
  }
}

function createHistoryBarElement(loadingHistory: boolean, loadOlderTurns: () => void): HTMLElement {
  const historyBar = createDiv({ cls: "codex-panel__history-bar" });
  const loadOlder = historyBar.createEl("button", {
    text: loadingHistory ? "Loading..." : "Load older",
  });
  loadOlder.disabled = loadingHistory;
  loadOlder.onclick = loadOlderTurns;
  return historyBar;
}

function createDisplayItemElement(item: DisplayItem, context: MessageStreamContext): HTMLElement {
  const container = createDiv();
  renderDisplayItem(container, item, context);
  return container.firstElementChild as HTMLElement;
}

function createActivityGroupElement(group: Extract<DisplayBlock, { type: "activityGroup" }>, context: MessageStreamContext): HTMLElement {
  const container = createDiv();
  const details = createRememberedDetails(
    container,
    context.openDetails,
    `turn:${group.turnId}:activity`,
    "codex-panel__activity-group",
    group.summary,
    false,
    context.onDetailsToggle,
  );
  for (const item of group.items) {
    renderDisplayItem(details, item, context);
  }
  return container.firstElementChild as HTMLElement;
}

function renderDisplayItem(parent: HTMLElement, item: DisplayItem, context: MessageStreamContext): void {
  if (item.kind === "command") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "fileChange") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "taskProgress") {
    renderTaskProgressItem(parent, item);
    return;
  }
  if (item.kind === "agent") {
    renderAgentItem(parent, item, context);
    return;
  }
  if (item.kind === "reasoning") {
    renderReasoningItem(parent, item, context);
    return;
  }
  if (item.kind === "tool" || item.kind === "hook") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "reviewResult") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "approvalResult") {
    renderToolResult(parent, item, context);
    return;
  }
  if (!isRenderableMessageItem(item)) {
    return;
  }
  const messageEl = parent.createDiv({ cls: messageClass(item) });
  applyExecutionStateClass(messageEl, executionState(item));
  const role = messageEl.createDiv({ cls: "codex-panel__message-role" });
  role.createSpan({ text: displayRoleLabel(item) });
  if (item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context)) {
    renderMessageAction(role, "copy", "Copy message", "codex-panel__copy-message", () => context.copyText?.(item.copyText ?? item.text));
  }
  if (context.canImplementPlanItem?.(item)) {
    renderMessageAction(role, "play", "Implement plan", "codex-panel__implement-plan", () => context.onImplementPlanItem?.(item));
  }
  if (context.canRollbackItem?.(item)) {
    renderMessageAction(role, "undo-2", "Rollback last turn", "codex-panel__rollback-turn", () => context.onRollbackItem?.(item));
  }
  const collapsible = isCollapsibleUserMessage(item);
  const contentParent = collapsible ? messageEl.createDiv({ cls: "codex-panel__message-collapse" }) : messageEl;
  const content = contentParent.createDiv({ cls: `codex-panel__message-content ${item.markdown === false ? "" : "markdown-rendered"}` });
  if (item.markdown === false) {
    context.renderTextWithWikiLinks(content, item.text);
  } else {
    context.renderMarkdown(content, item.text);
  }
  if (collapsible) {
    renderUserMessageCollapse(contentParent, content, item.id, context);
  }
  if (item.kind === "message" && item.editedFiles && item.editedFiles.length > 0) {
    renderEditedFiles(messageEl, item, context);
  }
  if (item.kind === "message" && item.referencedThread) {
    renderReferencedThread(messageEl, item);
  }
  if (item.kind === "message" && item.mentionedFiles && item.mentionedFiles.length > 0) {
    renderMentionedFiles(messageEl, item, context);
  }
  if (item.kind === "message" && item.autoReviewSummaries && item.autoReviewSummaries.length > 0) {
    renderAutoReviewSummaries(messageEl, item.autoReviewSummaries);
  }
  if (item.kind === "system" && item.details && item.details.length > 0) {
    renderSystemDetails(messageEl, item.details);
  } else {
    const details = "details" in item ? item.details : undefined;
    if (details && details.length > 0) {
      renderMessageDetails(messageEl, item.id, details, context);
    }
  }
}

function isCollapsibleUserMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "user";
}

function renderUserMessageCollapse(parent: HTMLElement, content: HTMLElement, itemId: string, context: MessageStreamContext): void {
  const key = `message:${itemId}:expanded`;
  const details = parent.createEl("details", { cls: "codex-panel__message-collapse-details" });
  details.createEl("summary", { text: "Show more" });

  const update = () => {
    const overflows = content.scrollHeight > userMessageCollapseHeight(content) + 1;
    const expanded = context.openDetails.has(key);
    parent.classList.toggle("codex-panel__message-collapse--overflow", overflows);
    parent.classList.toggle("codex-panel__message-collapse--expanded", overflows && expanded);
    content.classList.toggle("codex-panel__message-content--collapsed", overflows && !expanded);
    details.hidden = !overflows || expanded;
  };

  details.ontoggle = () => {
    if (!details.open) return;
    details.open = false;
    context.openDetails.add(key);
    update();
    context.onDetailsToggle?.();
  };

  content.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, update);
  update();
  content.win.requestAnimationFrame(update);
}

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}

function renderMessageAction(parent: HTMLElement, icon: string, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = createIconButton(parent, icon, label, `codex-panel__message-action ${className}`);
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  return button;
}

function renderReferencedThread(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>): void {
  const reference = item.referencedThread;
  if (!reference) return;
  const wrapper = parent.createDiv({ cls: "codex-panel__referenced-thread" });
  const label = wrapper.createSpan({ cls: "codex-panel__referenced-thread-label" });
  label.createSpan({ text: "Referenced " });
  label.createSpan({ text: reference.title });
  label.createSpan({ cls: "codex-panel__edited-files-separator", text: "·" });
  label.createSpan({ text: `${String(reference.includedTurns)}/${String(reference.turnLimit)} turns` });
}

function renderEditedFiles(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>, context: MessageStreamContext): void {
  const editedFiles = item.editedFiles ?? [];
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  const wrapper = parent.createDiv({ cls: "codex-panel__edited-files" });
  const details = wrapper.createEl("details", { cls: "codex-panel__edited-files-details" });
  const summary = details.createEl("summary");
  const summaryContent = summary.createSpan({ cls: "codex-panel__edited-files-summary" });
  summaryContent.createSpan({ text: label });
  if (item.turnDiff && item.turnId && context.activeThreadId && context.openTurnDiff) {
    summaryContent.createSpan({ cls: "codex-panel__edited-files-separator", text: "·" });
    const button = createIconButton(summaryContent, "file-diff", "View diff", "codex-panel__open-turn-diff");
    button.createSpan({ cls: "codex-panel__open-turn-diff-label", text: "View diff" });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.openTurnDiff?.({
        threadId: context.activeThreadId ?? "",
        turnId: item.turnId ?? "",
        cwd: context.workspaceRoot ?? null,
        files: editedFiles,
        diff: item.turnDiff?.diff ?? "",
      });
    };
  }
  const list = details.createEl("ul");
  for (const file of editedFiles) {
    list.createEl("li", { text: file });
  }
}

export function notifyMessageContentRendered(element: HTMLElement): void {
  element.dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT));
}

function renderMentionedFiles(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>, context: MessageStreamContext): void {
  const mentionedFiles = item.mentionedFiles ?? [];
  const label = mentionedFiles.length === 1 ? "Mentioned 1 file" : `Mentioned ${String(mentionedFiles.length)} files`;
  const wrapper = parent.createDiv({ cls: "codex-panel__mentioned-files" });
  const details = createRememberedDetails(
    wrapper,
    context.openDetails,
    `${item.id}:mentioned-files`,
    "codex-panel__mentioned-files-details",
    label,
    false,
    context.onDetailsToggle,
  );
  const list = details.createEl("ul");
  for (const file of mentionedFiles) {
    const row = list.createEl("li");
    row.createSpan({ text: file.name });
    row.createSpan({ cls: "codex-panel__edited-files-separator", text: " · " });
    row.createSpan({ text: file.path });
  }
}

function renderAutoReviewSummaries(parent: HTMLElement, summaries: string[]): void {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${String(summaries.length)} requests`;
  const details = parent.createEl("details", { cls: "codex-panel__auto-reviews" });
  details.createEl("summary", { text: label });
  const list = details.createEl("ul");
  for (const summary of summaries) {
    list.createEl("li", { text: summary });
  }
}

function displayRoleLabel(item: DisplayItem): string {
  if (item.kind === "approvalResult") return "Approval";
  if (item.kind === "userInputResult") return "Input";
  if (item.kind === "reviewResult") return "Review";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function messageClass(item: DisplayItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}

function renderMessageDetails(parent: HTMLElement, itemId: string, details: DisplayDetailSection[], context: MessageStreamContext): void {
  for (const [index, section] of details.entries()) {
    const summary = section.title ?? "Details";
    const detailsEl = createRememberedDetails(
      parent,
      context.openDetails,
      `${itemId}:message-detail:${String(index)}`,
      "codex-panel__output",
      summary,
      false,
      context.onDetailsToggle,
    );
    if (section.rows && section.rows.length > 0) {
      const rows = detailsEl.createEl("dl", { cls: "codex-panel__meta-grid" });
      for (const row of section.rows) {
        createMetaPair(rows, row.key, row.value);
      }
    }
    if (section.body) detailsEl.createEl("pre", { text: section.body });
  }
}

function renderSystemDetails(parent: HTMLElement, details: DisplayDetailSection[]): void {
  for (const section of details) {
    const sectionEl = parent.createDiv({ cls: "codex-panel__output codex-panel__system-result-section" });
    if (section.title) sectionEl.createDiv({ cls: "codex-panel__output-title", text: section.title });
    if (section.rows && section.rows.length > 0) {
      const rows = sectionEl.createEl("dl", { cls: "codex-panel__meta-grid" });
      for (const row of section.rows) {
        createMetaPair(rows, row.key, row.value);
      }
    }
    if (section.body) sectionEl.createEl("pre", { text: section.body });
  }
}
