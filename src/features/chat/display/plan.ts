import type { DisplayItem, ExecutionState } from "./types";

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

export function taskStatusMarker(status: TaskStepStatus): string {
  if (status === "completed") return "[x]";
  if (status === "inProgress") return "[>]";
  return "[ ]";
}

export function taskProgressExecutionState(status: string): ExecutionState {
  return executionStateFromStatus(status, TASK_STATES);
}

export function normalizeProposedPlanMarkdown(text: string): string {
  return text
    .replace(/^\s*<proposed_plan>\s*\n?/i, "")
    .replace(/\n?\s*<\/proposed_plan>\s*$/i, "")
    .trim();
}

export function planProgressDisplayItem(turnId: string, explanation: string | null, plan: readonly TaskPlanStep[]): DisplayItem {
  const trimmedExplanation = explanation?.trim();
  const lines = plan.map((step) => `${taskStatusMarker(step.status)} ${step.step}`);
  const body = [trimmedExplanation, ...lines].filter((line): line is string => Boolean(line && line.length > 0)).join("\n");
  const status = plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "inProgress" : "completed";
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    text: body.length > 0 ? body : "Plan updated",
    turnId,
    itemId: `plan-progress-${turnId}`,
    explanation: trimmedExplanation !== undefined && trimmedExplanation.length > 0 ? trimmedExplanation : null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    status,
    executionState: taskProgressExecutionState(status),
  };
}

function executionStateFromStatus(status: string, states: ExecutionStateByStatus): ExecutionState {
  return states[status] ?? null;
}
