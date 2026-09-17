// A finished turn may stop without a known success or failure result.
export type TurnOutcome = "completed" | "failed" | "interrupted" | "unknown";

export function turnOutcomeLabel(outcome: TurnOutcome): string {
  switch (outcome) {
    case "completed":
      return "Turn completed.";
    case "failed":
      return "Turn failed.";
    case "interrupted":
      return "Turn interrupted.";
    case "unknown":
      return "Turn ended.";
  }
}
