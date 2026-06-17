import { agentRunSummaryLabel } from "./agent-summary";
import { shortThreadId } from "../../../../utils";
import type {
  AgentRunSummary,
  AgentRunSummaryAgent,
  ExecutionState,
  MessageStreamItem,
  ReasoningMessageStreamItem,
  TaskProgressMessageStreamItem,
} from "../../domain/message-stream/items";

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

function agentRunSummaryRow(agent: AgentRunSummaryAgent): { threadId: string; threadLabel: string; status: string } {
  return {
    threadId: agent.threadId,
    threadLabel: shortThreadId(agent.threadId),
    status: agent.messagePreview ? `${agent.status}: ${agent.messagePreview}` : agent.status,
  };
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
