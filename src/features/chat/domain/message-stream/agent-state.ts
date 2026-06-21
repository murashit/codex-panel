import type { ExecutionState } from "./items";
import { executionStateFromStatus, RUNNING_EXECUTION_STATE, type ExecutionStateByStatus } from "./execution-state";

const AGENT_STATES: ExecutionStateByStatus = {
  pendingInit: RUNNING_EXECUTION_STATE,
  running: RUNNING_EXECUTION_STATE,
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
  shutdown: "completed",
  interrupted: "failed",
  errored: "failed",
  notFound: "failed",
  failed: "failed",
};

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, AGENT_STATES);
}
