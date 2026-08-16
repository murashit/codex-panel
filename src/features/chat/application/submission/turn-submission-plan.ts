export interface TurnSubmissionPlanningState {
  busy: boolean;
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export type TurnSubmissionPlan =
  | { kind: "blocked"; message: string }
  | { kind: "steer"; threadId: string; turnId: string }
  | { kind: "start-thread-then-turn" }
  | { kind: "start-turn"; threadId: string };

export function planTurnSubmission(state: TurnSubmissionPlanningState): TurnSubmissionPlan {
  if (state.busy) {
    return state.activeThreadId && state.activeTurnId
      ? { kind: "steer", threadId: state.activeThreadId, turnId: state.activeTurnId }
      : { kind: "blocked", message: "Current turn is not steerable yet." };
  }
  return state.activeThreadId ? { kind: "start-turn", threadId: state.activeThreadId } : { kind: "start-thread-then-turn" };
}
