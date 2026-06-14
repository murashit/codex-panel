import type { ExecutionState } from "./items";

type MessageStreamExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, MessageStreamExecutionState>>;

const AGENT_STATES: ExecutionStateByStatus = {
  pendingInit: "running",
  running: "running",
  inProgress: "running",
  completed: "completed",
  shutdown: "completed",
  interrupted: "failed",
  errored: "failed",
  notFound: "failed",
  failed: "failed",
};

export function collabAgentStateExecutionState(status: string): ExecutionState {
  return AGENT_STATES[status] ?? null;
}
