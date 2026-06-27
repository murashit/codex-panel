import { type MessageStreamExecutionState, RUNNING_EXECUTION_STATE } from "../../../domain/message-stream/execution-state";
import type { ExecutionState } from "../../../domain/message-stream/items";

export { RUNNING_EXECUTION_STATE };

export type ExecutionStateByStatus = Readonly<Record<string, MessageStreamExecutionState>>;

const COMMAND_STATES = {
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const PATCH_STATES = {
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const STANDARD_TOOL_STATES = {
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

const COLLAB_AGENT_STATES = {
  pendingInit: RUNNING_EXECUTION_STATE,
  running: RUNNING_EXECUTION_STATE,
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  shutdown: "completed",
  interrupted: "failed",
  errored: "failed",
  notFound: "failed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

export function commandExecutionState(status: string, exitCode?: number): ExecutionState {
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  const state = executionStateFromStatus(status, COMMAND_STATES);
  if (state) return state;
  if (typeof exitCode === "number") return "completed";
  return null;
}

export function patchApplyExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, PATCH_STATES);
}

export function mcpToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function dynamicToolCallExecutionState(status: string, success?: boolean | null): ExecutionState {
  if (success === false) return "failed";
  const state = standardToolCallExecutionState(status);
  if (state) return state;
  return success === true ? "completed" : null;
}

export function imageGenerationExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, COLLAB_AGENT_STATES);
}

export function appServerFailedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function standardToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

export function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
