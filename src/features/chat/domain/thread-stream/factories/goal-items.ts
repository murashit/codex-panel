import { truncate } from "../../../../../domain/display/text-preview";
import type { ThreadGoal, ThreadGoalStatus } from "../../../../../domain/threads/goal";
import type { GoalThreadStreamItem } from "../items";

const GOAL_SUMMARY_LIMIT = 140;

function goalChangeAction(previous: ThreadGoal | null, next: ThreadGoal | null): string | null {
  if (!previous && next) return "set";
  if (previous && !next) return "cleared";
  if (!previous || !next) return null;
  if (previous.status !== next.status) return goalStatusAction(next.status);
  if (previous.objective !== next.objective || previous.tokenBudget !== next.tokenBudget) return "updated";
  return null;
}

export function goalChangeItem(id: string, previous: ThreadGoal | null, next: ThreadGoal | null): GoalThreadStreamItem | null {
  const action = goalChangeAction(previous, next);
  if (!action) return null;
  const objective = next?.objective ?? previous?.objective;
  return {
    id,
    kind: "goal",
    role: "tool",
    text: goalEventSummary(action, objective),
    provenance: { source: "panel", channel: "notice", reason: "goalChange", sourceId: id },
    action,
    ...(objective ? { objective } : {}),
  };
}

function goalEventSummary(action: string, objective: string | undefined): string {
  const objectiveSummary = objective?.replace(/\s+/g, " ").trim();
  return truncate(objectiveSummary ? `${action}: ${objectiveSummary}` : action, GOAL_SUMMARY_LIMIT);
}

function goalStatusAction(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "resumed";
    case "paused":
      return "paused";
    case "complete":
      return "completed";
    case "blocked":
      return "blocked";
    case "usageLimited":
      return "usage limited";
    case "budgetLimited":
      return "budget limited";
  }
}
