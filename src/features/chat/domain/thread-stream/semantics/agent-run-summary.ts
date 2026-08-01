import { agentMessagePreview } from "../format/agent-message-preview";
import type { AgentRunSummary, AgentRunSummaryAgent, AgentStateSummary, ExecutionState, ThreadStreamItem } from "../items";
import {
  type AgentCoordinationLifecycle,
  type AgentCoordinationUpdate,
  agentCoordinationExecutionState,
  applyAgentCoordinationUpdate,
  UNKNOWN_AGENT_COORDINATION_LIFECYCLE,
} from "./agent-coordination";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
const ACTIVE_AGENT_ROW_LIMIT = 3;

export interface ActiveSubagentActivity extends AgentCoordinationLifecycle {
  readonly agentLabel: string | null;
  readonly messagePreview: string | null;
}

type AgentRunState = "running" | "completed" | "failed";
type ActiveAgentState = AgentStateSummary & { agentLabel?: string };

export function activeAgentRunSummary(
  items: readonly ThreadStreamItem[],
  activeTurnId: string | null,
  subagentActivities?: ReadonlyMap<string, ActiveSubagentActivity>,
): AgentRunSummary | null {
  if (!activeTurnId) return null;

  const agentStatuses = new Map<string, ActiveAgentState>();
  for (const item of items) {
    if (item.kind !== "agent" || item.turnId !== activeTurnId) continue;
    if (item.coordinationUpdate !== "snapshot") {
      applyAgentLifecycleUpdate(agentStatuses, item, item.coordinationUpdate);
      continue;
    }
    const labels = new Map(item.targets.map((target) => [target.threadId, target.label]));
    if (item.agents.length > 0) {
      for (const agent of item.agents) {
        agentStatuses.set(agent.threadId, {
          ...agent,
          ...definedAgentLabel(labels.get(agent.threadId)),
          executionState: agent.executionState ?? "running",
        });
      }
    } else {
      for (const target of item.targets) {
        agentStatuses.set(target.threadId, {
          threadId: target.threadId,
          ...definedAgentLabel(target.label),
          status: item.status,
          executionState: item.executionState ?? "running",
          message: null,
        });
      }
    }
  }
  for (const [threadId, activity] of subagentActivities ?? []) {
    const current = agentStatuses.get(threadId);
    const executionState = agentCoordinationExecutionState(activity);
    if (!current) {
      agentStatuses.set(threadId, {
        threadId,
        ...definedAgentLabel(activity.agentLabel ?? undefined),
        status: activity.outcome ?? activity.liveness,
        executionState,
        message: null,
      });
      continue;
    }
    agentStatuses.set(threadId, {
      ...current,
      ...definedAgentLabel(activity.agentLabel ?? undefined),
      status: executionState && executionState !== current.executionState ? executionState : current.status,
      executionState: activity.liveness === "unknown" && !activity.outcome ? current.executionState : executionState,
    });
  }

  if (agentStatuses.size === 0) return null;

  const summary = { running: 0, completed: 0, failed: 0, agents: [] as AgentRunSummaryAgent[], additionalAgents: 0 };
  const agents = [...agentStatuses.values()];
  for (const agent of agents) {
    const state = agentRunState(agent);
    if (state) summary[state] += 1;
  }

  if (summary.running === 0 && summary.failed === 0) return null;

  const runningAgents = agents
    .filter((agent) => agentRunState(agent) === "running")
    .map((agent) => ({
      threadId: agent.threadId,
      ...(agent.agentLabel ? { agentLabel: agent.agentLabel } : {}),
      status: agent.status,
      messagePreview:
        subagentActivities?.get(agent.threadId)?.messagePreview ?? agentMessagePreview(agent.message, ACTIVE_AGENT_PREVIEW_LIMIT),
    }))
    .sort((a, b) => Number(Boolean(b.messagePreview)) - Number(Boolean(a.messagePreview)) || a.threadId.localeCompare(b.threadId));
  summary.agents = runningAgents.slice(0, ACTIVE_AGENT_ROW_LIMIT);
  summary.additionalAgents = runningAgents.length - summary.agents.length;

  return summary;
}

function applyAgentLifecycleUpdate(
  states: Map<string, ActiveAgentState>,
  item: Extract<ThreadStreamItem, { kind: "agent" }>,
  update: Exclude<AgentCoordinationUpdate, "snapshot">,
): void {
  for (const target of item.targets) applyAgentTargetLifecycleUpdate(states, item, target, update);
}

function applyAgentTargetLifecycleUpdate(
  states: Map<string, ActiveAgentState>,
  item: Extract<ThreadStreamItem, { kind: "agent" }>,
  target: Extract<ThreadStreamItem, { kind: "agent" }>["targets"][number],
  update: Exclude<AgentCoordinationUpdate, "snapshot">,
): void {
  const current = states.get(target.threadId);
  if (update === "interacted" && !current) return;
  const previousLifecycle = current
    ? agentCoordinationLifecycleFromExecutionState(current.executionState)
    : UNKNOWN_AGENT_COORDINATION_LIFECYCLE;
  const lifecycle = applyAgentCoordinationUpdate(previousLifecycle, update);
  if (current && lifecycle === previousLifecycle) {
    states.set(target.threadId, {
      ...current,
      ...definedAgentLabel(target.label),
      ...(update === "interacted" ? { status: item.status } : {}),
    });
    return;
  }
  states.set(target.threadId, {
    threadId: target.threadId,
    ...definedAgentLabel(target.label),
    status: item.status,
    executionState: agentCoordinationExecutionState(lifecycle),
    message: null,
  });
}

function agentCoordinationLifecycleFromExecutionState(executionState: ExecutionState): AgentCoordinationLifecycle {
  if (executionState === "running") return { liveness: "running", outcome: null };
  if (executionState === "completed" || executionState === "failed") {
    return { liveness: "stopped", outcome: executionState };
  }
  return { liveness: "stopped", outcome: null };
}

function definedAgentLabel(label: string | undefined): { agentLabel: string } | Record<string, never> {
  return label ? { agentLabel: label } : {};
}

function agentRunState(agent: AgentStateSummary): AgentRunState | null {
  return agent.executionState;
}
