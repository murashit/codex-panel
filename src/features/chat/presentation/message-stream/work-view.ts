import { shortThreadId, truncate } from "../../../../utils";
import { agentActivityMetaLabel, agentMessagePreview, agentRunSummaryLabel } from "./agent-summary";
import type {
  AgentMessageStreamItem,
  AgentRunSummary,
  AgentRunSummaryAgent,
  AgentStateSummary,
  ContextCompactionMessageStreamItem,
  ExecutionState,
  MessageStreamItem,
  ReasoningMessageStreamItem,
  TaskProgressMessageStreamItem,
} from "../../domain/message-stream/items";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;
const AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT = 96;

export type WorkMessageStreamItem =
  | TaskProgressMessageStreamItem
  | AgentMessageStreamItem
  | ReasoningMessageStreamItem
  | ContextCompactionMessageStreamItem;

export type MessageStreamWorkView =
  | {
      kind: "taskProgress";
      item: TaskProgressMessageStreamItem;
      label: "tasks";
      className: string;
      state: ExecutionState;
    }
  | {
      kind: "agent";
      item: AgentMessageStreamItem;
      label: "agent";
      className: string;
      state: ExecutionState;
      summary: string;
      metaRows: readonly { key: string; value: string }[];
      prompt: string | null;
      agentRows: readonly { threadId: string; threadLabel: string; status: string }[];
      expandedMessages: readonly { threadId: string; threadLabel: string; message: string }[];
    }
  | {
      kind: "contextCompaction";
      item: ContextCompactionMessageStreamItem;
      label: "context";
      className: string;
      state: ExecutionState;
      summary: string;
    }
  | {
      kind: "reasoning";
      item: ReasoningMessageStreamItem;
      active: boolean;
      label: string;
      text: string;
    };

export interface MessageStreamWorkViewContext {
  activeTurnId: string | null;
  items: readonly MessageStreamItem[];
  activeItems?: readonly MessageStreamItem[] | undefined;
}

export interface AgentRunSummaryView {
  label: "agents";
  className: string;
  state: ExecutionState;
  summary: string;
  rows: readonly { threadId: string; threadLabel: string; status: string }[];
  additionalAgents: number;
}

export function messageStreamWorkView(item: WorkMessageStreamItem, context: MessageStreamWorkViewContext): MessageStreamWorkView {
  if (item.kind === "taskProgress") {
    return { kind: "taskProgress", item, label: "tasks", className: "codex-panel__task-progress", state: item.executionState ?? null };
  }
  if (item.kind === "agent") return agentWorkView(item);
  if (item.kind === "contextCompaction") return contextCompactionWorkView(item, context);
  return reasoningWorkView(item, context);
}

export function agentRunSummaryView(summary: AgentRunSummary): AgentRunSummaryView {
  return {
    label: "agents",
    className: "codex-panel__agent-summary",
    state: summary.failed > 0 ? "failed" : "running",
    summary: agentRunSummaryLabel(summary),
    rows: summary.agents.map(agentRunSummaryRow),
    additionalAgents: summary.additionalAgents,
  };
}

function agentWorkView(item: AgentMessageStreamItem): MessageStreamWorkView {
  return {
    kind: "agent",
    item,
    label: "agent",
    className: "codex-panel__agent-activity",
    state: item.executionState ?? null,
    summary: agentSummaryText(item),
    metaRows: [
      { key: "tool", value: agentActivityMetaLabel(item.tool) },
      { key: "status", value: item.status },
      { key: "sender", value: item.senderThreadId },
      ...(item.receiverThreadIds.length > 0 ? [{ key: "target", value: item.receiverThreadIds.join(", ") }] : []),
      ...(item.model ? [{ key: "model", value: item.model }] : []),
      ...(item.reasoningEffort ? [{ key: "effort", value: item.reasoningEffort }] : []),
    ],
    prompt: item.prompt,
    agentRows: item.agents.map(agentStatusRow),
    expandedMessages: item.agents.flatMap((agent) =>
      agent.message && isLongAgentMessage(agent.message)
        ? [{ threadId: agent.threadId, threadLabel: shortThreadId(agent.threadId), message: agent.message }]
        : [],
    ),
  };
}

function contextCompactionWorkView(item: ContextCompactionMessageStreamItem, context: MessageStreamWorkViewContext): MessageStreamWorkView {
  const active = context.activeTurnId === item.turnId;
  return {
    kind: "contextCompaction",
    item,
    label: "context",
    className: "codex-panel__context-compaction",
    state: active ? "running" : "completed",
    summary: active ? "Compacting context..." : "Context compacted",
  };
}

function reasoningWorkView(item: ReasoningMessageStreamItem, context: MessageStreamWorkViewContext): MessageStreamWorkView {
  const active = isReasoningActive(item, context);
  return {
    kind: "reasoning",
    item,
    active,
    label: active ? "reasoning" : "thought",
    text: item.text || (active ? "Reasoning" : "Thought"),
  };
}

function agentSummaryText(item: AgentMessageStreamItem): string {
  const target = item.receiverThreadIds.length === 0 ? "" : ` ${item.receiverThreadIds.map(shortThreadId).join(", ")}`;
  const promptPreview = agentPromptPreview(item.prompt);
  return `${agentActivityMetaLabel(item.tool)}${target}${promptPreview ? `: ${promptPreview}` : ""} (${item.status})`;
}

function agentPromptPreview(prompt: string | null): string | null {
  if (!prompt) return null;
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized ? truncate(normalized, AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT) : null;
}

function agentStatusRow(agent: AgentStateSummary): { threadId: string; threadLabel: string; status: string } {
  return {
    threadId: agent.threadId,
    threadLabel: shortThreadId(agent.threadId),
    status: agentStatusLabel(agent.status, agent.message),
  };
}

function agentRunSummaryRow(agent: AgentRunSummaryAgent): { threadId: string; threadLabel: string; status: string } {
  return {
    threadId: agent.threadId,
    threadLabel: shortThreadId(agent.threadId),
    status: agent.messagePreview ? `${agent.status}: ${agent.messagePreview}` : agent.status,
  };
}

function agentStatusLabel(status: string, message: string | null): string {
  const preview = agentMessagePreview(message, AGENT_ROW_MESSAGE_PREVIEW_LIMIT);
  return preview ? `${status}: ${preview}` : status;
}

function isLongAgentMessage(message: string): boolean {
  return message.length > AGENT_ROW_MESSAGE_PREVIEW_LIMIT || message.includes("\n");
}

function isReasoningActive(item: ReasoningMessageStreamItem, context: MessageStreamWorkViewContext): boolean {
  const activeTurn = context.activeTurnId;
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (item.executionState === "completed") return false;
  const latestActiveTurnItem = [...(context.activeItems ?? context.items)].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}
