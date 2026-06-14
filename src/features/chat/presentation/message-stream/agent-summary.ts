import { truncate } from "../../../../utils";
import { collabAgentStateExecutionState } from "../../domain/message-stream/agent-state";
import type { AgentRunSummary, AgentRunSummaryAgent, AgentStateSummary, MessageStreamItem } from "../../domain/message-stream/items";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
type AgentRunState = "running" | "completed" | "failed";

export function agentActivityMetaLabel(tool: string): string {
  if (tool === "spawnAgent") return "spawn";
  if (tool === "sendInput") return "send input";
  if (tool === "resumeAgent") return "resume";
  if (tool === "wait") return "wait";
  if (tool === "closeAgent") return "close";
  return tool;
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

export function agentRunSummaryLabel(summary: AgentRunSummary): string {
  const parts: string[] = [];
  if (summary.failed > 0) parts.push(`${String(summary.failed)} failed`);
  if (summary.running > 0) parts.push(`${String(summary.running)} running`);
  if (summary.completed > 0) parts.push(`${String(summary.completed)} done`);
  return `Agents ${parts.join(", ")}`;
}

export function agentMessagePreview(message: string | null, maxLength: number): string | null {
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
