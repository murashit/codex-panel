import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../domain/threads/goal";

interface AppServerThreadGoal {
  threadId: string;
  objective: string;
  status: AppServerThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

type AppServerThreadGoalStatus = ThreadGoalStatus;
type AppServerJsonValue = number | string | boolean | AppServerJsonValue[] | { [key: string]: AppServerJsonValue | undefined } | null;

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

export function appServerThreadGoalUpdate(update: ThreadGoalUpdate): {
  objective?: string | null;
  status?: AppServerThreadGoalStatus | null;
  tokenBudget?: number | null;
} {
  return {
    ...("objective" in update ? { objective: update.objective } : {}),
    ...("status" in update ? { status: update.status === null ? null : update.status } : {}),
    ...("tokenBudget" in update ? { tokenBudget: update.tokenBudget } : {}),
  };
}

export function appServerThreadGoalUserHistoryItem(text: string): AppServerJsonValue {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
