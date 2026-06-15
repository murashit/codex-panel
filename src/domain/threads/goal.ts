export type ThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export interface ThreadGoal {
  readonly threadId: string;
  readonly objective: string;
  readonly status: ThreadGoalStatus;
  readonly tokenBudget: number | null;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ThreadGoalUpdate {
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
}
