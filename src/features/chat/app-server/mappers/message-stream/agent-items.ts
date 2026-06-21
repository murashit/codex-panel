import { definedProp } from "../../../../../utils";
import type { AgentMessageStreamItem, AgentStateSummary, ExecutionState } from "../../../domain/message-stream/items";
import { collabAgentStateExecutionState } from "../../../domain/message-stream/agent-state";
import {
  executionStateFromStatus,
  RUNNING_EXECUTION_STATE,
  type ExecutionStateByStatus,
} from "../../../domain/message-stream/execution-state";

const STANDARD_TOOL_STATES: ExecutionStateByStatus = {
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
};

interface MessageStreamCollabAgentToolCall {
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, MessageStreamCollabAgentState | undefined>;
}

interface MessageStreamCollabAgentState {
  status?: string | null;
  message?: string | null;
}

export function agentMessageStreamItem(item: MessageStreamCollabAgentToolCall, turnId?: string): AgentMessageStreamItem {
  const agents = agentStatesDisplay(item.agentsStates);
  return {
    id: item.id,
    kind: "agent",
    role: "tool",
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

function agentStatesDisplay(states: MessageStreamCollabAgentToolCall["agentsStates"]): AgentStateSummary[] {
  return Object.entries(states)
    .map(([threadId, state]) => ({
      threadId,
      status: state?.status ?? "unknown",
      message: state?.message ?? null,
    }))
    .sort((a, b) => a.threadId.localeCompare(b.threadId));
}

function collabAgentExecutionState(tool: string, status: string, receiverThreadIds: string[], agents: AgentStateSummary[]): ExecutionState {
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

function collabAgentToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}
