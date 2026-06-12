import type { ThreadGoal as AppServerThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalStatus as AppServerThreadGoalStatus } from "../../generated/app-server/v2/ThreadGoalStatus";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../domain/threads/goal";

export type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";

export function threadGoalFromAppServerGoal(goal: AppServerThreadGoal | null): ThreadGoal | null {
  if (!goal) return null;
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: threadGoalStatusFromAppServerStatus(goal.status),
    tokenBudget: goal.tokenBudget,
    tokensUsed: finiteNumber(goal.tokensUsed),
    timeUsedSeconds: finiteNumber(goal.timeUsedSeconds),
    createdAt: finiteNumber(goal.createdAt),
    updatedAt: finiteNumber(goal.updatedAt),
  };
}

export function appServerThreadGoalUpdate(update: ThreadGoalUpdate): {
  objective?: string | null;
  status?: AppServerThreadGoalStatus | null;
  tokenBudget?: number | null;
} {
  return {
    ...("objective" in update ? { objective: update.objective } : {}),
    ...("status" in update ? { status: update.status === null ? null : appServerThreadGoalStatus(update.status) } : {}),
    ...("tokenBudget" in update ? { tokenBudget: update.tokenBudget } : {}),
  };
}

export function appServerThreadGoalUserHistoryItem(text: string): JsonValue {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function threadGoalStatusFromAppServerStatus(status: AppServerThreadGoalStatus): ThreadGoalStatus {
  return status;
}

function appServerThreadGoalStatus(status: ThreadGoalStatus): AppServerThreadGoalStatus {
  return status;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
