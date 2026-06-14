import type { ThreadGoal, ThreadGoalStatus } from "../../../../../domain/threads/goal";
import { truncate } from "../../../../../utils";
import type { GoalMessageStreamItem } from "../items";

const GOAL_SUMMARY_LIMIT = 140;

function goalChangeMessage(previous: ThreadGoal | null, next: ThreadGoal | null): string | null {
  if (!previous && next) return "Goal set.";
  if (previous && !next) return "Goal cleared.";
  if (!previous || !next) return null;
  if (previous.status !== next.status) return goalStatusMessage(next.status);
  if (previous.objective !== next.objective || previous.tokenBudget !== next.tokenBudget) return "Goal updated.";
  return null;
}

export function goalChangeItem(id: string, previous: ThreadGoal | null, next: ThreadGoal | null): GoalMessageStreamItem | null {
  const message = goalChangeMessage(previous, next);
  if (!message) return null;
  const objective = next?.objective ?? previous?.objective;
  const action = goalActionLabel(message);
  return {
    id,
    kind: "goal",
    role: "tool",
    text: goalEventSummary(message, objective),
    provenance: { source: "panel", channel: "notice", reason: "goalChange", sourceId: id },
    action,
    ...(objective ? { objective } : {}),
  };
}

function goalEventSummary(message: string, objective: string | undefined): string {
  const summary = goalActionLabel(message);
  const objectiveSummary = objective?.replace(/\s+/g, " ").trim();
  return truncate(objectiveSummary ? `${summary}: ${objectiveSummary}` : summary, GOAL_SUMMARY_LIMIT);
}

function goalActionLabel(message: string): string {
  const label = message.endsWith(".") ? message.slice(0, -1) : message;
  return label.replace(/^Goal\s+/u, "");
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
