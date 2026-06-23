import { truncate } from "../../../../../utils";
import { collabAgentStateExecutionState } from "../agent-state";
import type {
  AgentRunSummary,
  AgentRunSummaryAgent,
  AgentStateSummary,
  MessageStreamItem,
  ReasoningMessageStreamItem,
  TaskProgressMessageStreamItem,
} from "../items";
import { messageStreamSemanticClassifications } from "./classify";
import { messageStreamIsCoordinationProgress } from "./predicates";
import type { MessageStreamSemanticClassification } from "./types";

const ACTIVE_AGENT_PREVIEW_LIMIT = 96;
type AgentRunState = "running" | "completed" | "failed";

export interface ActiveTurnItemsContext {
  activeTurnId: string | null;
  items: readonly MessageStreamItem[];
  activeItems?: readonly MessageStreamItem[] | undefined;
}

export type ActiveTurnLiveItem =
  | {
      kind: "taskProgress";
      item: TaskProgressMessageStreamItem;
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
  const semanticItems = messageStreamSemanticClassifications(items);
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(semanticItems, activeTurnId);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummary(items, activeTurnId) : null;

  return semanticItems.flatMap((classification): ActiveTurnLiveItem[] => {
    const { item } = classification;
    if (messageStreamItemIsActiveTaskProgress(item, activeTurnId)) {
      return [{ kind: "taskProgress", item }];
    }
    if (item.id === agentSummaryAnchorId && agentSummary) {
      return [{ kind: "agentSummary", anchorItemId: item.id, summary: agentSummary }];
    }
    return [];
  });
}

export function messageStreamItemsWithoutActiveTaskProgress(
  items: readonly MessageStreamItem[],
  activeTurnId: string,
): MessageStreamItem[] {
  return items.filter((item) => !messageStreamItemIsActiveTaskProgress(item, activeTurnId));
}

function activeAgentRunSummary(items: readonly MessageStreamItem[], activeTurnId: string | null): AgentRunSummary | null {
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
        agentStatuses.set(threadId, { threadId, status: item.status, message: null });
      }
    }
  }

  if (agentStatuses.size === 0) return null;

  const summary = { running: 0, completed: 0, failed: 0, agents: [] as AgentRunSummaryAgent[], additionalAgents: 0 };
  const agents = [...agentStatuses.values()];
  for (const agent of agents) {
    const state = agentRunState(agent.status);
    summary[state] += 1;
  }

  if (summary.running === 0 && summary.failed === 0) return null;

  summary.agents = agents
    .filter((agent) => agentRunState(agent.status) === "running")
    .sort((a, b) => a.threadId.localeCompare(b.threadId))
    .map((agent) => ({
      threadId: agent.threadId,
      status: agent.status,
      messagePreview: agentMessagePreview(agent.message, ACTIVE_AGENT_PREVIEW_LIMIT),
    }));

  return summary;
}

export function messageStreamReasoningIsActive(item: ReasoningMessageStreamItem, context: ActiveTurnItemsContext): boolean {
  const activeTurn = context.activeTurnId;
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (item.executionState === "completed") return false;
  const latestActiveTurnItem = [...(context.activeItems ?? context.items)].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}

function messageStreamItemIsActiveTaskProgress(item: MessageStreamItem, activeTurnId: string): item is TaskProgressMessageStreamItem {
  return item.kind === "taskProgress" && item.turnId === activeTurnId;
}

function activeAgentRunSummaryAnchorId(items: readonly MessageStreamSemanticClassification[], activeTurnId: string): string | null {
  const firstActiveAgent = items.find(
    (classification) => messageStreamIsCoordinationProgress(classification) && classification.item.turnId === activeTurnId,
  );
  return firstActiveAgent?.item.id ?? null;
}

function agentMessagePreview(message: string | null, maxLength: number): string | null {
  if (!message) return null;
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return truncate(firstLine.replace(/\s+/g, " "), maxLength);
}

function agentRunState(status: string): AgentRunState {
  return collabAgentStateExecutionState(status) ?? "running";
}
