import type { ExecutionState, MessageStreamItem } from "../items";

type MessageStreamExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, MessageStreamExecutionState>>;

const TASK_STATES = {
  pending: "running",
  inProgress: "running",
  completed: "completed",
} as const satisfies ExecutionStateByStatus;

type TaskStepStatus = "pending" | "inProgress" | "completed";

export interface TaskPlanStep {
  step: string;
  status: TaskStepStatus;
}

export function taskProgressExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, TASK_STATES);
}

export function taskProgressMessageStreamItem(
  turnId: string,
  explanation: string | null,
  plan: readonly TaskPlanStep[],
): MessageStreamItem {
  const trimmedExplanation = explanation?.trim();
  const status = plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "inProgress" : "completed";
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    sourceItemId: `plan-progress-${turnId}`,
    provenance: { source: "appServer", channel: "notification", event: "taskProgress", sourceItemId: `plan-progress-${turnId}` },
    explanation: trimmedExplanation !== undefined && trimmedExplanation.length > 0 ? trimmedExplanation : null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    status,
    executionState: taskProgressExecutionState(status),
  };
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
