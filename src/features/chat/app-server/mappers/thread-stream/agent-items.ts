import type { AgentStateSummary, AgentThreadStreamItem, ExecutionState } from "../../../domain/thread-stream/items";
import {
  collabAgentStateExecutionState,
  type ExecutionStateByStatus,
  executionStateFromStatus,
  RUNNING_EXECUTION_STATE,
} from "./execution-state";

const STANDARD_TOOL_STATES: ExecutionStateByStatus = {
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
};

interface ThreadStreamCollabAgentToolCall {
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, ThreadStreamCollabAgentState | undefined>;
}

interface ThreadStreamCollabAgentState {
  status?: string | null;
  message?: string | null;
}

export function agentThreadStreamItem(item: ThreadStreamCollabAgentToolCall, turnId?: string): AgentThreadStreamItem {
  const agents = agentStatesDisplay(item.agentsStates);
  return {
    id: item.id,
    kind: "agent",
    role: "tool",
    ...definedProp("turnId", turnId),
    sourceItemId: item.id,
    action: agentCoordinationAction(item.tool),
    coordinationUpdate: "snapshot",
    status: item.status,
    senderThreadId: item.senderThreadId,
    targets: item.receiverThreadIds.map((threadId) => ({ threadId })),
    prompt: item.prompt,
    model: item.model,
    reasoningEffort: item.reasoningEffort,
    agents,
    executionState: collabAgentExecutionState(item.tool, item.status, item.receiverThreadIds, agents),
  };
}

export function subagentActivityThreadStreamItem(
  item: { id: string; kind: "started" | "interacted" | "interrupted"; agentThreadId: string; agentPath: string },
  turnId?: string,
): AgentThreadStreamItem {
  const id = `subagent-activity:${item.id}`;
  return {
    id,
    kind: "agent",
    role: "tool",
    ...definedProp("turnId", turnId),
    sourceItemId: id,
    action: subagentActivityAction(item.kind),
    coordinationUpdate: item.kind,
    status: item.kind,
    senderThreadId: null,
    targets: [{ threadId: item.agentThreadId, label: item.agentPath }],
    prompt: null,
    model: null,
    reasoningEffort: null,
    agents: [],
  };
}

function subagentActivityAction(kind: "started" | "interacted" | "interrupted"): string {
  if (kind === "started") return "spawn";
  if (kind === "interacted") return "interact";
  return "interrupt";
}

function agentCoordinationAction(tool: string): string {
  if (tool === "spawnAgent") return "spawn";
  if (tool === "sendInput") return "interact";
  if (tool === "resumeAgent") return "resume";
  if (tool === "closeAgent") return "close";
  return tool;
}

function agentStatesDisplay(states: ThreadStreamCollabAgentToolCall["agentsStates"]): AgentStateSummary[] {
  return Object.entries(states)
    .map(([threadId, state]) => {
      const status = state?.status ?? "unknown";
      return {
        threadId,
        status,
        executionState: collabAgentStateExecutionState(status),
        message: state?.message ?? null,
      };
    })
    .sort((a, b) => a.threadId.localeCompare(b.threadId));
}

function collabAgentExecutionState(tool: string, status: string, receiverThreadIds: string[], agents: AgentStateSummary[]): ExecutionState {
  if (tool === "spawnAgent") return collabAgentToolCallExecutionState(status);
  if (agents.some((agent) => agent.executionState === "failed")) return "failed";
  if (agents.some((agent) => agent.executionState === "running")) return "running";
  if (agents.length > 0 && agents.every((agent) => agent.executionState === "completed")) {
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

function definedProp<Key extends string, Value>(key: Key, value: Value | null | undefined): Record<Key, Value> | Record<string, never> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
