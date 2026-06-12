import type { AgentDisplayItem, AgentRunSummary, AgentRunSummaryAgent, AgentStateDisplay, DisplayItem, ExecutionState } from "./types";
import { definedProp, truncate } from "../../../utils";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
type AgentRunState = "running" | "completed" | "failed";
type DisplayExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, DisplayExecutionState>>;

const AGENT_STATES = {
  pendingInit: "running",
  running: "running",
  inProgress: "running",
  completed: "completed",
  shutdown: "completed",
  interrupted: "failed",
  errored: "failed",
  notFound: "failed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

const STANDARD_TOOL_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

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

export function agentActivitySummaryLabel(tool: string): string {
  if (tool === "spawnAgent") return "Spawn agent";
  if (tool === "sendInput") return "Send input to agent";
  if (tool === "resumeAgent") return "Resume agent";
  if (tool === "wait") return "Wait for agent";
  if (tool === "closeAgent") return "Close agent";
  return `Agent ${tool}`;
}

export function agentActivityMetaLabel(tool: string): string {
  if (tool === "spawnAgent") return "spawn";
  if (tool === "sendInput") return "send input";
  if (tool === "resumeAgent") return "resume";
  if (tool === "wait") return "wait";
  if (tool === "closeAgent") return "close";
  return tool;
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

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AGENT_STATES);
}

function collabAgentToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
