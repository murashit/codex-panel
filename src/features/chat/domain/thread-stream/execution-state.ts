import type { ExecutionState } from "./items";

export type ThreadStreamExecutionState = Exclude<ExecutionState, null>;
export const RUNNING_EXECUTION_STATE: ThreadStreamExecutionState = "running";
