import { displayBlocksForItems, executionState } from "../display/model";
import { displayItemSignature } from "../display/signature";
import type { DisplayBlock, DisplayDetailSection, DisplayItem } from "../display/types";
import { createIconButton, createMetaPair, createRememberedDetails } from "./components";
import { applyExecutionStateClass } from "./execution-state";
import { renderToolResult } from "./tool-result";
import {
  activeAgentRunSummaryBlock,
  createAgentRunSummaryElement,
  renderAgentItem,
  renderReasoningItem,
  renderTaskProgressItem,
} from "./work-items";

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
  workspaceRoot?: string | null;
  openDetails: Set<string>;
  onDetailsToggle?: () => void;
  loadOlderTurns: () => void;
  renderMarkdown: (parent: HTMLElement, text: string) => void;
  renderTextWithWikiLinks: (parent: HTMLElement, text: string) => void;
  copyText?: (text: string) => void;
  canRollbackItem?: (item: DisplayItem) => boolean;
  onRollbackItem?: (item: DisplayItem) => void;
  pendingRequestsSignature?: string;
  renderPendingRequests?: () => HTMLElement | null;
}

export function messageRenderBlocks(context: MessageStreamContext): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      signature: `${context.activeThreadId}:${context.historyCursor}:${context.loadingHistory}`,
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
          text: "Start a new thread or send a message.",
        }),
    });
    return blocks;
  }

  for (const block of displayBlocksForItems(context.displayItems, context.activeTurnId, context.workspaceRoot)) {
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
      key: `active-agents:${context.activeTurnId}`,
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
  if (item.kind !== "message" && item.kind !== "system" && item.kind !== "userInputResult") {
    return;
  }

  const messageEl = parent.createDiv({ cls: messageClass(item) });
  applyExecutionStateClass(messageEl, executionState(item));
  const role = messageEl.createDiv({ cls: "codex-panel__message-role" });
  role.createSpan({ text: displayRoleLabel(item) });
  if (item.kind === "message" && item.copyText !== undefined && context.copyText) {
    renderMessageAction(role, "copy", "Copy message", "codex-panel__copy-message", () => context.copyText?.(item.copyText ?? item.text));
  }
  if (context.canRollbackItem?.(item)) {
    renderMessageAction(role, "undo-2", "Rollback last turn", "codex-panel__rollback-turn", () => context.onRollbackItem?.(item));
  }
  const content = messageEl.createDiv({ cls: `codex-panel__message-content ${item.markdown === false ? "" : "markdown-rendered"}` });
  if (item.markdown === false) {
    context.renderTextWithWikiLinks(content, item.text);
  } else {
    context.renderMarkdown(content, item.text);
  }
  if (item.kind === "message" && item.editedFiles && item.editedFiles.length > 0) {
    renderEditedFiles(messageEl, item.editedFiles);
  }
  if (item.kind === "message" && item.autoReviewSummaries && item.autoReviewSummaries.length > 0) {
    renderAutoReviewSummaries(messageEl, item.autoReviewSummaries);
  }
  if ("details" in item && item.details && item.details.length > 0) {
    renderMessageDetails(messageEl, item.id, item.details, context);
  }
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

function renderEditedFiles(parent: HTMLElement, editedFiles: string[]): void {
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${editedFiles.length} files`;
  const details = parent.createEl("details", { cls: "codex-panel__edited-files" });
  details.createEl("summary", { text: label });
  const list = details.createEl("ul");
  for (const file of editedFiles) {
    list.createEl("li", { text: file });
  }
}

function renderAutoReviewSummaries(parent: HTMLElement, summaries: string[]): void {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${summaries.length} requests`;
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
      `${itemId}:message-detail:${index}`,
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
