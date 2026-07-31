import { agentMessagePreview } from "../format/agent-message-preview";
import type {
  AgentRunSummary,
  AgentRunSummaryAgent,
  AgentStateSummary,
  ReasoningThreadStreamItem,
  TaskProgressThreadStreamItem,
  ThreadStreamItem,
} from "../items";
import { threadStreamSemanticClassifications } from "./classify";
import { threadStreamIsCoordinationProgress } from "./predicates";
import type { ThreadStreamSemanticClassification } from "./types";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
const ACTIVE_AGENT_ROW_LIMIT = 3;
type AgentRunState = "running" | "completed" | "failed";
type ActiveAgentState = AgentStateSummary & { agentLabel?: string };

export interface ActiveTurnItemsContext {
  activeTurnId: string | null;
  items: readonly ThreadStreamItem[];
  activeItems?: readonly ThreadStreamItem[] | undefined;
  subagentActivities?: ReadonlyMap<string, ActiveSubagentActivity> | undefined;
}

export interface ActiveSubagentActivity {
  readonly agentLabel: string | null;
  readonly liveness: "unknown" | "running" | "stopped";
  readonly outcome: "completed" | "failed" | null;
  readonly messagePreview: string | null;
}

export type ActiveTurnLiveItem =
  | {
      kind: "taskProgress";
      item: TaskProgressThreadStreamItem;
    }
  | {
      kind: "agentSummary";
      anchorItemId: string;
      summary: AgentRunSummary;
    };

export function activeTurnLiveItems(
  input: Pick<ActiveTurnItemsContext, "items" | "activeItems" | "subagentActivities">,
  activeTurnId: string,
): ActiveTurnLiveItem[] {
  const items = input.activeItems ?? input.items;
  const semanticItems = threadStreamSemanticClassifications(items);
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(semanticItems, activeTurnId);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummary(items, activeTurnId, input.subagentActivities) : null;

  return semanticItems.flatMap((classification): ActiveTurnLiveItem[] => {
    const { item } = classification;
    if (threadStreamItemIsActiveTaskProgress(item, activeTurnId)) {
      return [{ kind: "taskProgress", item }];
    }
    if (item.id === agentSummaryAnchorId && agentSummary) {
      return [{ kind: "agentSummary", anchorItemId: item.id, summary: agentSummary }];
    }
    return [];
  });
}

export function threadStreamItemsWithoutActiveTaskProgress(items: readonly ThreadStreamItem[], activeTurnId: string): ThreadStreamItem[] {
  return items.filter((item) => !threadStreamItemIsActiveTaskProgress(item, activeTurnId));
}

function activeAgentRunSummary(
  items: readonly ThreadStreamItem[],
  activeTurnId: string | null,
  subagentActivities?: ReadonlyMap<string, ActiveSubagentActivity>,
): AgentRunSummary | null {
  if (!activeTurnId) return null;

  const agentStatuses = new Map<string, ActiveAgentState>();
  for (const item of items) {
    if (item.kind !== "agent" || item.turnId !== activeTurnId) continue;
    if (item.coordinationUpdate !== "snapshot") {
      applyAgentLifecycleUpdate(agentStatuses, item);
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
    const executionState = trackedActivityExecutionState(activity);
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

export function threadStreamReasoningIsActive(item: ReasoningThreadStreamItem, context: ActiveTurnItemsContext): boolean {
  const activeTurn = context.activeTurnId;
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (item.executionState === "completed") return false;
  const latestActiveTurnItem = [...(context.activeItems ?? context.items)].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}

function threadStreamItemIsActiveTaskProgress(item: ThreadStreamItem, activeTurnId: string): item is TaskProgressThreadStreamItem {
  return item.kind === "taskProgress" && item.turnId === activeTurnId;
}

function activeAgentRunSummaryAnchorId(items: readonly ThreadStreamSemanticClassification[], activeTurnId: string): string | null {
  const firstActiveAgent = items.find(
    (classification) => threadStreamIsCoordinationProgress(classification) && classification.item.turnId === activeTurnId,
  );
  return firstActiveAgent?.item.id ?? null;
}

function applyAgentLifecycleUpdate(states: Map<string, ActiveAgentState>, item: Extract<ThreadStreamItem, { kind: "agent" }>): void {
  for (const target of item.targets) applyAgentTargetLifecycleUpdate(states, item, target);
}

function applyAgentTargetLifecycleUpdate(
  states: Map<string, ActiveAgentState>,
  item: Extract<ThreadStreamItem, { kind: "agent" }>,
  target: Extract<ThreadStreamItem, { kind: "agent" }>["targets"][number],
): void {
  const current = states.get(target.threadId);
  if (item.coordinationUpdate === "interacted") {
    if (current) states.set(target.threadId, { ...current, ...definedAgentLabel(target.label), status: item.status });
    return;
  }
  if (item.coordinationUpdate === "started" && current?.executionState === null) {
    states.set(target.threadId, { ...current, ...definedAgentLabel(target.label) });
    return;
  }
  states.set(target.threadId, {
    threadId: target.threadId,
    ...definedAgentLabel(target.label),
    status: item.status,
    executionState: item.coordinationUpdate === "started" ? "running" : null,
    message: null,
  });
}

function definedAgentLabel(label: string | undefined): { agentLabel: string } | Record<string, never> {
  return label ? { agentLabel: label } : {};
}

function trackedActivityExecutionState(activity: ActiveSubagentActivity): AgentStateSummary["executionState"] {
  if (activity.outcome) return activity.outcome;
  return activity.liveness === "running" ? "running" : null;
}

function agentRunState(agent: AgentStateSummary): AgentRunState | null {
  return agent.executionState;
}
