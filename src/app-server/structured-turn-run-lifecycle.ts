export type StructuredTurnRunLifecycleState =
  | { kind: "starting" }
  | { kind: "thread-started"; threadId: string }
  | { kind: "turn-started"; threadId: string; turnId: string }
  | { kind: "completed" };

export type StructuredTurnRunLifecycleEvent =
  | { type: "thread-started"; threadId: string }
  | { type: "turn-started"; threadId: string; turnId: string }
  | { type: "completed" };

export function createStructuredTurnRunLifecycle(): StructuredTurnRunLifecycleState {
  return { kind: "starting" };
}

export function transitionStructuredTurnRunLifecycle(
  state: StructuredTurnRunLifecycleState,
  event: StructuredTurnRunLifecycleEvent,
): StructuredTurnRunLifecycleState {
  if (state.kind === "completed") return state;
  switch (event.type) {
    case "thread-started":
      return { kind: "thread-started", threadId: event.threadId };
    case "turn-started":
      return { kind: "turn-started", threadId: event.threadId, turnId: event.turnId };
    case "completed":
      return { kind: "completed" };
  }
}

export function structuredTurnRunMatches(state: StructuredTurnRunLifecycleState, threadId: string, turnId: string): boolean {
  if (state.kind === "thread-started") return state.threadId === threadId;
  if (state.kind === "turn-started") return state.threadId === threadId && state.turnId === turnId;
  return false;
}
