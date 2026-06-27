import {
  type ExecutionStateByStatus,
  executionStateFromStatus,
  RUNNING_EXECUTION_STATE,
} from "../../../domain/message-stream/execution-state";
import type { MessageStreamItem } from "../../../domain/message-stream/items";

const TASK_STATES = {
  pending: RUNNING_EXECUTION_STATE,
  inProgress: RUNNING_EXECUTION_STATE,
  completed: "completed",
} as const satisfies ExecutionStateByStatus;

type TaskStepStatus = "pending" | "inProgress" | "completed";

interface TaskPlanStep {
  step: string;
  status: TaskStepStatus;
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
    executionState: executionStateFromStatus(status, TASK_STATES),
  };
}
