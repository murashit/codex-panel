import type { ReasoningThreadStreamItem, TaskProgressThreadStreamItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import { type ActiveSubagentActivity, type AgentRunSummary, activeAgentRunSummary } from "./agent-run-summary";

export interface ActiveTurnItemsContext {
  activeTurnId: string | null;
  activeItems: readonly ThreadStreamItem[];
  subagentActivities?: ReadonlyMap<string, ActiveSubagentActivity> | undefined;
}

export type ActiveTurnLiveItem =
  | {
      kind: "taskProgress";
      item: TaskProgressThreadStreamItem;
    }
  | {
      kind: "agentSummary";
      summary: AgentRunSummary;
    };

export function activeTurnLiveItems(
  input: Pick<ActiveTurnItemsContext, "activeItems" | "subagentActivities">,
  activeTurnId: string,
): ActiveTurnLiveItem[] {
  const items = input.activeItems;
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(items, activeTurnId);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummary(items, activeTurnId, input.subagentActivities) : null;

  return items.flatMap((item): ActiveTurnLiveItem[] => {
    if (threadStreamItemIsActiveTaskProgress(item, activeTurnId)) {
      return [{ kind: "taskProgress", item }];
    }
    if (item.id === agentSummaryAnchorId && agentSummary) {
      return [{ kind: "agentSummary", summary: agentSummary }];
    }
    return [];
  });
}

export function threadStreamItemsWithoutActiveTaskProgress(items: readonly ThreadStreamItem[], activeTurnId: string): ThreadStreamItem[] {
  return items.filter((item) => !threadStreamItemIsActiveTaskProgress(item, activeTurnId));
}

export function threadStreamReasoningIsActive(item: ReasoningThreadStreamItem, context: ActiveTurnItemsContext): boolean {
  const activeTurn = context.activeTurnId;
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (item.executionState === "completed") return false;
  const latestActiveTurnItem = [...context.activeItems].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}

function threadStreamItemIsActiveTaskProgress(item: ThreadStreamItem, activeTurnId: string): item is TaskProgressThreadStreamItem {
  return item.kind === "taskProgress" && item.turnId === activeTurnId;
}

function activeAgentRunSummaryAnchorId(items: readonly ThreadStreamItem[], activeTurnId: string): string | null {
  const firstActiveAgent = items.find((item) => item.kind === "agent" && item.turnId === activeTurnId);
  return firstActiveAgent?.id ?? null;
}
