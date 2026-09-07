import type { ThreadStreamItem } from "../../../domain/thread-stream/items";

type TaskStepStatus = "pending" | "inProgress" | "completed";

interface TaskPlanStep {
  step: string;
  status: TaskStepStatus;
}

export function taskProgressThreadStreamItem(turnId: string, explanation: string | null, plan: readonly TaskPlanStep[]): ThreadStreamItem {
  const trimmedExplanation = explanation?.trim();
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    sourceItemId: `plan-progress-${turnId}`,
    provenance: { source: "appServer", channel: "notification", event: "taskProgress", sourceItemId: `plan-progress-${turnId}` },
    explanation: trimmedExplanation !== undefined && trimmedExplanation.length > 0 ? trimmedExplanation : null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    executionState: plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "running" : "completed",
  };
}
