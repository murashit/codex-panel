import type { AgentDisplayItem, AgentStateDisplay, ExecutionState } from "../types";
import { definedProp } from "../../../../utils";

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
    sourceItemId: item.id,
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

function agentActivitySummaryLabel(tool: string): string {
  if (tool === "spawnAgent") return "Spawn agent";
  if (tool === "sendInput") return "Send input to agent";
  if (tool === "resumeAgent") return "Resume agent";
  if (tool === "wait") return "Wait for agent";
  if (tool === "closeAgent") return "Close agent";
  return `Agent ${tool}`;
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

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AGENT_STATES);
}

function collabAgentToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
