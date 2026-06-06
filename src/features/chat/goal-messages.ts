import type { ThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../../generated/app-server/v2/ThreadGoalStatus";

export function goalChangeMessage(previous: ThreadGoal | null, next: ThreadGoal | null): string | null {
  if (!previous && next) return "Goal set.";
  if (previous && !next) return "Goal cleared.";
  if (!previous || !next) return null;
  if (previous.status !== next.status) return goalStatusMessage(next.status);
  if (previous.objective !== next.objective || previous.tokenBudget !== next.tokenBudget) return "Goal updated.";
  return null;
}

function goalStatusMessage(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "Goal resumed.";
    case "paused":
      return "Goal paused.";
    case "complete":
      return "Goal completed.";
    case "blocked":
      return "Goal blocked.";
    case "usageLimited":
      return "Goal usage limited.";
    case "budgetLimited":
      return "Goal budget limited.";
  }
}
