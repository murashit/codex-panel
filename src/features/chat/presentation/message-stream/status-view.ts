import { shortThreadId, truncate } from "../../../../utils";
import { collabAgentStateExecutionState } from "../../domain/message-stream/agent-state";
import type {
  AgentRunSummary,
  AgentRunSummaryAgent,
  AgentStateSummary,
  ExecutionState,
  MessageStreamItem,
  ReasoningMessageStreamItem,
  TaskProgressMessageStreamItem,
} from "../../domain/message-stream/items";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
type AgentRunState = "running" | "completed" | "failed";

export type StatusChecklistItem = TaskProgressMessageStreamItem["steps"][number];

export type MessageStreamStatusView =
  | {
      kind: "taskProgress";
      label: "tasks";
      className: string;
      state: ExecutionState;
      summary: string | null;
      checklist: readonly StatusChecklistItem[];
    }
  | {
      kind: "contextCompaction";
      label: "context";
      className: string;
      state: ExecutionState;
      text: string;
    }
  | {
      kind: "reasoning";
      active: boolean;
      label: string;
      text: string;
    }
  | {
      kind: "generic";
      label: string;
      className: string;
      state: ExecutionState;
      text: string;
    };

export interface MessageStreamStatusViewContext {
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

export function messageStreamStatusView(item: MessageStreamItem, context: MessageStreamStatusViewContext): MessageStreamStatusView {
  if (item.kind === "taskProgress") {
    return {
      kind: "taskProgress",
      label: "tasks",
      className: "codex-panel__task-progress",
      state: item.executionState ?? null,
      summary: item.explanation,
      checklist: item.steps,
    };
  }
  if (item.kind === "contextCompaction") return contextCompactionStatusView(item, context);
  if (item.kind === "reasoning") return reasoningStatusView(item, context);
  return genericStatusView(item);
}

export function activeAgentRunSummary(items: readonly MessageStreamItem[], activeTurnId: string | null): AgentRunSummary | null {
  if (!activeTurnId) return null;

  const agentStatuses = new Map<string, AgentStateSummary>();
  for (const item of items) {
    if (item.kind !== "agent" || item.turnId !== activeTurnId) continue;
    if (item.agents.length > 0) {
      for (const agent of item.agents) {
        agentStatuses.set(agent.threadId, agent);
      }
    } else {
      for (const threadId of item.receiverThreadIds) {
        agentStatuses.set(threadId, { threadId, status: item.status, message: null });
      }
    }
  }

  if (agentStatuses.size === 0) return null;

  const summary = { running: 0, completed: 0, failed: 0, agents: [] as AgentRunSummaryAgent[], additionalAgents: 0 };
  const agents = [...agentStatuses.values()];
  for (const agent of agents) {
    const state = agentRunState(agent.status);
    summary[state] += 1;
  }

  if (summary.running === 0 && summary.failed === 0) return null;

  summary.agents = agents
    .filter((agent) => agentRunState(agent.status) === "running")
    .sort((a, b) => a.threadId.localeCompare(b.threadId))
    .map((agent) => ({
      threadId: agent.threadId,
      status: agent.status,
      messagePreview: agentMessagePreview(agent.message, ACTIVE_AGENT_PREVIEW_LIMIT),
    }));

  return summary;
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

function contextCompactionStatusView(item: MessageStreamItem, context: MessageStreamStatusViewContext): MessageStreamStatusView {
  const active = context.activeTurnId === item.turnId;
  return {
    kind: "contextCompaction",
    label: "context",
    className: "codex-panel__context-compaction",
    state: active ? "running" : "completed",
    text: active ? "Compacting context..." : "Context compacted",
  };
}

function reasoningStatusView(item: ReasoningMessageStreamItem, context: MessageStreamStatusViewContext): MessageStreamStatusView {
  const active = isReasoningActive(item, context);
  return {
    kind: "reasoning",
    active,
    label: active ? "reasoning" : "thought",
    text: item.text || (active ? "Reasoning" : "Thought"),
  };
}

function genericStatusView(item: MessageStreamItem): MessageStreamStatusView {
  return {
    kind: "generic",
    label: item.kind,
    className: "codex-panel__status-item",
    state: item.executionState ?? null,
    text:
      stringField(item, "text") ??
      stringField(item, "status") ??
      stringField(item, "output") ??
      stringField(item, "failureReason") ??
      stringField(item, "operation") ??
      item.kind,
  };
}

function agentRunSummaryLabel(summary: AgentRunSummary): string {
  const parts: string[] = [];
  if (summary.failed > 0) parts.push(`${String(summary.failed)} failed`);
  if (summary.running > 0) parts.push(`${String(summary.running)} running`);
  if (summary.completed > 0) parts.push(`${String(summary.completed)} done`);
  return `Agents ${parts.join(", ")}`;
}

function agentRunSummaryRow(agent: AgentRunSummaryAgent): { threadId: string; threadLabel: string; status: string } {
  return {
    threadId: agent.threadId,
    threadLabel: shortThreadId(agent.threadId),
    status: agent.messagePreview ? `${agent.status}: ${agent.messagePreview}` : agent.status,
  };
}

function agentMessagePreview(message: string | null, maxLength: number): string | null {
  if (!message) return null;
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return truncate(firstLine.replace(/\s+/g, " "), maxLength);
}

function agentRunState(status: string): AgentRunState {
  return collabAgentStateExecutionState(status) ?? "running";
}

function isReasoningActive(item: ReasoningMessageStreamItem, context: MessageStreamStatusViewContext): boolean {
  const activeTurn = context.activeTurnId;
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (item.executionState === "completed") return false;
  const latestActiveTurnItem = [...(context.activeItems ?? context.items)].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}

function stringField(item: MessageStreamItem, key: "failureReason" | "operation" | "output" | "status" | "text"): string | null {
  if (!(key in item)) return null;
  const value = (item as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
