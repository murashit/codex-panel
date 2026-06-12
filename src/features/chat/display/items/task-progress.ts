import type { DisplayItem, ExecutionState } from "../types";

type DisplayExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, DisplayExecutionState>>;

const TASK_STATES = {
  pending: "running",
  inProgress: "running",
  completed: "completed",
} as const satisfies ExecutionStateByStatus;

export type TaskStepStatus = "pending" | "inProgress" | "completed";

export interface TaskPlanStep {
  step: string;
  status: TaskStepStatus;
}

export function taskProgressExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, TASK_STATES);
}

export function taskProgressDisplayItem(turnId: string, explanation: string | null, plan: readonly TaskPlanStep[]): DisplayItem {
  const trimmedExplanation = explanation?.trim();
  const lines = plan.map((step) => `${taskProgressTextMarker(step.status)} ${step.step}`);
  const body = [trimmedExplanation, ...lines].filter((line): line is string => Boolean(line && line.length > 0)).join("\n");
  const status = plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "inProgress" : "completed";
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    text: body.length > 0 ? body : "Plan updated",
    turnId,
    sourceItemId: `plan-progress-${turnId}`,
    explanation: trimmedExplanation !== undefined && trimmedExplanation.length > 0 ? trimmedExplanation : null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    status,
    executionState: taskProgressExecutionState(status),
  };
}

function taskProgressTextMarker(status: TaskStepStatus): string {
  if (status === "completed") return "[x]";
  if (status === "inProgress") return "[>]";
  return "[ ]";
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
