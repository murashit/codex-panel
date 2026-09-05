import type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";
import type { ThreadGoal as AppServerThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalSetParams } from "../../generated/app-server/v2/ThreadGoalSetParams";

export function threadGoalFromAppServerGoal(goal: AppServerThreadGoal | null): ThreadGoal | null {
  if (!goal) return null;
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: finiteNumber(goal.tokensUsed),
    timeUsedSeconds: finiteNumber(goal.timeUsedSeconds),
    createdAt: finiteNumber(goal.createdAt),
    updatedAt: finiteNumber(goal.updatedAt),
  };
}

export function appServerThreadGoalUpdate(update: ThreadGoalUpdate): Pick<ThreadGoalSetParams, "objective" | "status" | "tokenBudget"> {
  return {
    ...("objective" in update ? { objective: update.objective } : {}),
    ...("status" in update ? { status: update.status === null ? null : update.status } : {}),
    ...("tokenBudget" in update ? { tokenBudget: update.tokenBudget } : {}),
  };
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
