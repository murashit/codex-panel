import type { AgentRunSummary, ReasoningThreadStreamItem, TaskProgressThreadStreamItem, ThreadStreamItem } from "../items";
import { type ActiveSubagentActivity, activeAgentRunSummary } from "./agent-run-summary";
import { threadStreamSemanticClassifications } from "./classify";
import { threadStreamIsCoordinationProgress } from "./predicates";
import type { ThreadStreamSemanticClassification } from "./types";

export interface ActiveTurnItemsContext {
  activeTurnId: string | null;
  items: readonly ThreadStreamItem[];
  activeItems?: readonly ThreadStreamItem[] | undefined;
  subagentActivities?: ReadonlyMap<string, ActiveSubagentActivity> | undefined;
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
