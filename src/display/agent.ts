import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { AgentRunSummary, AgentRunSummaryAgent, AgentStateDisplay, DisplayItem, ExecutionState } from "./types";
import { definedProp } from "../utils";
import { agentActivitySummaryLabel, agentMessagePreview } from "./labels";
import { classifyExecutionState } from "./state";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
const ACTIVE_AGENT_PREVIEW_COUNT = 3;
type AgentRunState = "running" | "completed" | "failed";
type CollabAgentToolCallItem = Extract<ThreadItem, { type: "collabAgentToolCall" }>;

export function agentDisplayItem(item: CollabAgentToolCallItem, turnId?: string): DisplayItem {
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
    state: collabAgentExecutionState(item.status, item.receiverThreadIds, agents),
  };
}

export function activeAgentRunSummary(items: DisplayItem[], activeTurnId: string | null, busy: boolean): AgentRunSummary | null {
  if (!busy || !activeTurnId) return null;

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

  const visibleAgents = agents.sort(compareActiveAgentStates).slice(0, ACTIVE_AGENT_PREVIEW_COUNT);
  summary.agents = visibleAgents.map((agent) => ({
    threadId: agent.threadId,
    status: agent.status,
    messagePreview: agentMessagePreview(agent.message, ACTIVE_AGENT_PREVIEW_LIMIT),
  }));
  summary.additionalAgents = Math.max(0, agents.length - visibleAgents.length);

  return summary;
}

function agentStatesDisplay(states: CollabAgentToolCallItem["agentsStates"]): AgentStateDisplay[] {
  return Object.entries(states)
    .map(([threadId, state]) => ({
      threadId,
      status: state?.status ?? "unknown",
      message: state?.message ?? null,
    }))
    .sort((a, b) => a.threadId.localeCompare(b.threadId));
}

function collabAgentExecutionState(status: string, receiverThreadIds: string[], agents: AgentStateDisplay[]): ExecutionState {
  if (agents.some((agent) => classifyExecutionState({ status: agent.status }) === "failed")) return "failed";
  if (agents.some((agent) => classifyExecutionState({ status: agent.status }) === "running")) return "running";
  if (agents.length > 0 && agents.every((agent) => classifyExecutionState({ status: agent.status }) === "completed")) {
    return "completed";
  }
  if (receiverThreadIds.length > 0 && classifyExecutionState({ status }) === "completed") return "running";
  const state = classifyExecutionState({ status });
  if (state) return state;
  return null;
}

function agentRunState(status: string): AgentRunState {
  return classifyExecutionState({ status }) ?? "running";
}

function compareActiveAgentStates(a: AgentStateDisplay, b: AgentStateDisplay): number {
  const stateDiff = agentRunStatePriority(agentRunState(a.status)) - agentRunStatePriority(agentRunState(b.status));
  if (stateDiff !== 0) return stateDiff;
  return a.threadId.localeCompare(b.threadId);
}

function agentRunStatePriority(state: AgentRunState): number {
  if (state === "failed") return 0;
  if (state === "running") return 1;
  return 2;
}
