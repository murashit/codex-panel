import type { DisplayItem, ExecutionState } from "./types";

type DisplayExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, DisplayExecutionState>>;

const COMMAND_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const PATCH_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
  declined: "failed",
} as const satisfies ExecutionStateByStatus;

const STANDARD_TOOL_STATES = {
  inProgress: "running",
  completed: "completed",
  failed: "failed",
} as const satisfies ExecutionStateByStatus;

const TASK_STATES = {
  pending: "running",
  inProgress: "running",
  completed: "completed",
} as const satisfies ExecutionStateByStatus;

const AUTO_REVIEW_STATES = {
  inProgress: "running",
  approved: "completed",
  denied: "failed",
  timedOut: "failed",
  aborted: "failed",
} as const satisfies ExecutionStateByStatus;

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

export function executionState(item: DisplayItem): ExecutionState {
  return item.executionState ?? null;
}

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

export function taskProgressExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, TASK_STATES);
}

export function autoReviewExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AUTO_REVIEW_STATES);
}

export function collabAgentToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AGENT_STATES);
}

function standardToolCallExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, STANDARD_TOOL_STATES);
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
