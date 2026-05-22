import { activeAgentRunSummary } from "../display/agent";
import { isReasoningActive } from "../display/signature";
import { executionState } from "../display/state";
import type { AgentDisplayItem, AgentRunSummary, AgentRunSummaryAgent, DisplayItem, TaskProgressDisplayItem } from "../display/types";
import { agentActivityMetaLabel, agentMessagePreview, agentRunSummaryLabel, taskStatusMarker } from "../display/labels";
import type { MessageStreamContext } from "./message-stream";
import { createMetaPair, createRememberedDetails } from "./components";
import { createWorkMessage } from "./work-message";
import { shortThreadId } from "../utils";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;

export function activeAgentRunSummaryBlock(context: MessageStreamContext): AgentRunSummary | null {
  return activeAgentRunSummary(context.displayItems, context.activeTurnId, context.busy);
}

export function createAgentRunSummaryElement(summary: AgentRunSummary): HTMLElement {
  const messageEl = createWorkMessage(createDiv(), {
    label: "agents",
    className: "codex-panel__agent-summary",
    state: summary.failed > 0 ? "failed" : "running",
  });
  messageEl.createDiv({ cls: "codex-panel__tool-summary", text: agentRunSummaryLabel(summary) });
  renderAgentSummaryRows(messageEl, summary);
  return messageEl;
}

export function renderTaskProgressItem(parent: HTMLElement, item: TaskProgressDisplayItem): void {
  const messageEl = createWorkMessage(parent, {
    label: "tasks",
    className: "codex-panel__task-progress",
    state: executionState(item),
  });
  if (item.explanation) {
    messageEl.createDiv({ cls: "codex-panel__tool-summary", text: item.explanation });
  }
  if (item.steps.length === 0) {
    messageEl.createDiv({ cls: "codex-panel__tool-summary", text: "Plan updated" });
    return;
  }
  const list = messageEl.createEl("ul", { cls: "codex-panel__task-list" });
  for (const step of item.steps) {
    const row = list.createEl("li", { cls: `codex-panel__task-step codex-panel__task-step--${step.status}` });
    row.createSpan({ cls: "codex-panel__task-marker", text: taskStatusMarker(step.status) });
    row.createSpan({ cls: "codex-panel__task-text", text: step.step });
  }
}

export function renderAgentItem(parent: HTMLElement, item: AgentDisplayItem, context: MessageStreamContext): void {
  const messageEl = createWorkMessage(parent, {
    label: "agent",
    className: "codex-panel__agent-activity",
    state: executionState(item),
  });
  messageEl.createDiv({ cls: "codex-panel__tool-summary", text: agentSummaryText(item) });

  const details = createRememberedDetails(
    messageEl,
    context.openDetails,
    `${item.id}:agent-details`,
    "codex-panel__output codex-panel__agent-details",
    "Details",
    false,
    context.onDetailsToggle,
  );
  const meta = details.createEl("dl", { cls: "codex-panel__meta-grid" });
  createMetaPair(meta, "tool", agentActivityMetaLabel(item.tool));
  createMetaPair(meta, "status", item.status);
  createMetaPair(meta, "sender", item.senderThreadId);
  if (item.receiverThreadIds.length > 0) createMetaPair(meta, "target", item.receiverThreadIds.join(", "));
  if (item.model) createMetaPair(meta, "model", item.model);
  if (item.reasoningEffort) createMetaPair(meta, "effort", item.reasoningEffort);

  if (item.agents.length > 0) {
    const list = messageEl.createEl("ul", { cls: "codex-panel__agent-list" });
    for (const agent of item.agents) {
      const row = list.createEl("li", { cls: "codex-panel__agent-row" });
      row.title = agent.threadId;
      row.createSpan({ cls: "codex-panel__agent-thread", text: shortThreadId(agent.threadId) });
      row.createSpan({ cls: "codex-panel__agent-status", text: agentStatusLabel(agent.status, agent.message) });
    }
  }

  for (const agent of item.agents) {
    if (!agent.message || !isLongAgentMessage(agent.message)) continue;
    const details = createRememberedDetails(
      messageEl,
      context.openDetails,
      `${item.id}:agent:${agent.threadId}:message`,
      "codex-panel__output",
      `Agent output ${shortThreadId(agent.threadId)}`,
      false,
      context.onDetailsToggle,
    );
    details.createEl("pre", { text: agent.message });
  }

  if (item.prompt) {
    const details = createRememberedDetails(
      messageEl,
      context.openDetails,
      `${item.id}:prompt`,
      "codex-panel__output",
      "Prompt",
      false,
      context.onDetailsToggle,
    );
    details.createEl("pre", { text: item.prompt });
  }
}

export function renderReasoningItem(parent: HTMLElement, item: DisplayItem, context: MessageStreamContext): void {
  const messageEl = parent.createDiv({ cls: "codex-panel__reasoning" });
  const active = isReasoningActive(item, context);
  if (active) messageEl.addClass("is-active");
  messageEl.createDiv({ cls: "codex-panel__reasoning-role", text: active ? "reasoning" : "thought" });
  const content = messageEl.createDiv({ cls: "codex-panel__reasoning-content" });
  content.createSpan({ text: item.text || (active ? "Reasoning" : "Thought") });
  if (active) {
    const dots = content.createSpan({ cls: "codex-panel__reasoning-dots" });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
  }
}

function renderAgentSummaryRows(parent: HTMLElement, summary: AgentRunSummary): void {
  if (summary.agents.length === 0 && summary.additionalAgents === 0) return;
  const list = parent.createEl("ul", { cls: "codex-panel__agent-list codex-panel__agent-list--summary" });
  for (const agent of summary.agents) {
    const row = list.createEl("li", { cls: "codex-panel__agent-row" });
    row.title = agent.threadId;
    row.createSpan({ cls: "codex-panel__agent-thread", text: shortThreadId(agent.threadId) });
    row.createSpan({ cls: "codex-panel__agent-status", text: agentSummaryStatusLabel(agent) });
  }
  if (summary.additionalAgents > 0) {
    const row = list.createEl("li", { cls: "codex-panel__agent-row codex-panel__agent-row--more" });
    row.createSpan({ cls: "codex-panel__agent-thread", text: "" });
    row.createSpan({ cls: "codex-panel__agent-status", text: `+${String(summary.additionalAgents)} more` });
  }
}

function agentSummaryText(item: AgentDisplayItem): string {
  const target = item.receiverThreadIds.length === 0 ? "" : ` ${item.receiverThreadIds.map(shortThreadId).join(", ")}`;
  return `${agentActivityMetaLabel(item.tool)}${target} (${item.status})`;
}

function agentStatusLabel(status: string, message: string | null): string {
  const preview = agentMessagePreview(message, AGENT_ROW_MESSAGE_PREVIEW_LIMIT);
  return preview ? `${status}: ${preview}` : status;
}

function agentSummaryStatusLabel(agent: AgentRunSummaryAgent): string {
  return agent.messagePreview ? `${agent.status}: ${agent.messagePreview}` : agent.status;
}

function isLongAgentMessage(message: string): boolean {
  return message.length > AGENT_ROW_MESSAGE_PREVIEW_LIMIT || message.includes("\n");
}
