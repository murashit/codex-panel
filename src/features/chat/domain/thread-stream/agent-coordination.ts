export type AgentCoordinationUpdate = "snapshot" | "started" | "interacted" | "interrupted" | "completed";
type AgentCoordinationLiveness = "unknown" | "running" | "stopped";
type AgentCoordinationOutcome = "completed" | "failed" | null;
export type AgentCoordinationExecutionState = "running" | AgentCoordinationOutcome;

export interface AgentCoordinationLifecycle {
  readonly liveness: AgentCoordinationLiveness;
  readonly outcome: AgentCoordinationOutcome;
}

export const UNKNOWN_AGENT_COORDINATION_LIFECYCLE: AgentCoordinationLifecycle = {
  liveness: "unknown",
  outcome: null,
};

export function applyAgentCoordinationUpdate(
  lifecycle: AgentCoordinationLifecycle,
  update: Exclude<AgentCoordinationUpdate, "snapshot">,
): AgentCoordinationLifecycle {
  if (update === "started") {
    return lifecycle.liveness === "stopped" ? lifecycle : { ...lifecycle, liveness: "running" };
  }
  if (update === "interrupted") {
    return lifecycle.liveness === "stopped" ? lifecycle : { ...lifecycle, liveness: "stopped" };
  }
  if (update === "completed") {
    return lifecycle.outcome ? lifecycle : { liveness: "stopped", outcome: "completed" };
  }
  return lifecycle;
}

export function agentCoordinationExecutionState(lifecycle: AgentCoordinationLifecycle): AgentCoordinationExecutionState {
  if (lifecycle.outcome) return lifecycle.outcome;
  return lifecycle.liveness === "running" ? "running" : null;
}
