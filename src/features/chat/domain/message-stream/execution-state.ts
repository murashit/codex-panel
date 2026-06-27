import type { ExecutionState } from "./items";

export type MessageStreamExecutionState = Exclude<ExecutionState, null>;
export const RUNNING_EXECUTION_STATE: MessageStreamExecutionState = "running";
