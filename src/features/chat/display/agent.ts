import type { AgentDisplayItem, AgentRunSummary, AgentRunSummaryAgent, AgentStateDisplay, DisplayItem, ExecutionState } from "./types";
import { definedProp } from "../../../utils";
import { agentActivitySummaryLabel, agentMessagePreview } from "./labels";
import { collabAgentStateExecutionState, collabAgentToolCallExecutionState } from "./state";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
type AgentRunState = "running" | "completed" | "failed";

interface DisplayCollabAgentToolCall {
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, DisplayCollabAgentState | undefined>;
}

interface DisplayCollabAgentState {
  status?: string | null;
  message?: string | null;
}

export function agentDisplayItem(item: DisplayCollabAgentToolCall, turnId?: string): AgentDisplayItem {
  const agents = agentStatesDisplay(item.agentsStates);
  const receiverText = item.receiverThreadIds.length > 0 ? `\ntargets: ${item.receiverThreadIds.join(", ")}` : "";
  const promptText = item.prompt ? `\n${item.prompt}` : "";
  return {
    id: item.id,
    kind: "agent",
    role: "tool",
    text: `${agentActivitySummaryLabel(item.tool)}\nstatus: ${item.status}${receiverText}${promptText}`,
    ...definedProp("turnId", turnId),
    itemId: item.id,
    tool: item.tool,
    status: item.status,
    senderThreadId: item.senderThreadId,
    receiverThreadIds: item.receiverThreadIds,
    prompt: item.prompt,
    model: item.model,
    reasoningEffort: item.reasoningEffort,
    agents,
    executionState: collabAgentExecutionState(item.tool, item.status, item.receiverThreadIds, agents),
  };
}

export function activeAgentRunSummary(items: readonly DisplayItem[], activeTurnId: string | null): AgentRunSummary | null {
  if (!activeTurnId) return null;

  const agentStatuses = new Map<string, AgentStateDisplay>();
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

function agentStatesDisplay(states: DisplayCollabAgentToolCall["agentsStates"]): AgentStateDisplay[] {
  return Object.entries(states)
    .map(([threadId, state]) => ({
      threadId,
      status: state?.status ?? "unknown",
      message: state?.message ?? null,
    }))
    .sort((a, b) => a.threadId.localeCompare(b.threadId));
}

function collabAgentExecutionState(tool: string, status: string, receiverThreadIds: string[], agents: AgentStateDisplay[]): ExecutionState {
  if (tool === "spawnAgent") return collabAgentToolCallExecutionState(status);
  if (agents.some((agent) => collabAgentStateExecutionState(agent.status) === "failed")) return "failed";
  if (agents.some((agent) => collabAgentStateExecutionState(agent.status) === "running")) return "running";
  if (agents.length > 0 && agents.every((agent) => collabAgentStateExecutionState(agent.status) === "completed")) {
    return "completed";
  }
  if (receiverThreadIds.length > 0 && collabAgentToolCallExecutionState(status) === "completed") return "running";
  const state = collabAgentToolCallExecutionState(status);
  if (state) return state;
  return null;
}

function agentRunState(status: string): AgentRunState {
  return collabAgentStateExecutionState(status) ?? "running";
}
