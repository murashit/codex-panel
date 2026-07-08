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
type AgentRunState = "running" | "completed" | "failed";

export interface ActiveTurnItemsContext {
  activeTurnId: string | null;
  items: readonly ThreadStreamItem[];
  activeItems?: readonly ThreadStreamItem[] | undefined;
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
  input: Pick<ActiveTurnItemsContext, "items" | "activeItems">,
  activeTurnId: string,
): ActiveTurnLiveItem[] {
  const items = input.activeItems ?? input.items;
  const semanticItems = threadStreamSemanticClassifications(items);
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(semanticItems, activeTurnId);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummary(items, activeTurnId) : null;

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

function activeAgentRunSummary(items: readonly ThreadStreamItem[], activeTurnId: string | null): AgentRunSummary | null {
  if (!activeTurnId) return null;

  const agentStatuses = new Map<string, AgentStateSummary>();
  for (const item of items) {
    if (item.kind !== "agent" || item.turnId !== activeTurnId) continue;
    if (item.agents.length > 0) {
      for (const agent of item.agents) {
        agentStatuses.set(agent.threadId, agent);
      }
    } else {
      for (const threadId of item.receiverThreadIds) {
        agentStatuses.set(threadId, { threadId, status: item.status, executionState: item.executionState ?? "running", message: null });
      }
    }
  }

  if (agentStatuses.size === 0) return null;

  const summary = { running: 0, completed: 0, failed: 0, agents: [] as AgentRunSummaryAgent[], additionalAgents: 0 };
  const agents = [...agentStatuses.values()];
  for (const agent of agents) {
    const state = agentRunState(agent);
    summary[state] += 1;
  }

  if (summary.running === 0 && summary.failed === 0) return null;

  summary.agents = agents
    .filter((agent) => agentRunState(agent) === "running")
    .sort((a, b) => a.threadId.localeCompare(b.threadId))
    .map((agent) => ({
      threadId: agent.threadId,
      status: agent.status,
      messagePreview: agentMessagePreview(agent.message, ACTIVE_AGENT_PREVIEW_LIMIT),
    }));

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

function agentRunState(agent: AgentStateSummary): AgentRunState {
  return agent.executionState ?? "running";
}
