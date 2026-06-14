import { activeAgentRunSummary } from "./agent-summary";
import type { AgentRunSummary, MessageStreamItem, TaskProgressMessageStreamItem } from "../../domain/message-stream/items";
import {
  messageStreamIsCoordinationProgress,
  messageStreamIsTaskProgress,
  messageStreamSemanticClassifications,
} from "../../domain/message-stream/semantics";
import type { MessageStreamSemanticClassification } from "../../domain/message-stream/semantics";
import { messageStreamLayoutBlocks, type MessageStreamLayoutBlock } from "./layout";

export interface MessageStreamPresentationBlockInput {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  items: readonly MessageStreamItem[];
  stableItems?: readonly MessageStreamItem[] | undefined;
  activeItems?: readonly MessageStreamItem[] | undefined;
  workspaceRoot?: string | null | undefined;
  turnDiffs?: ReadonlyMap<string, string> | undefined;
}

export type MessageStreamPresentationBlock =
  | {
      kind: "historyBar";
      key: "history-bar";
      loadingHistory: boolean;
    }
  | {
      kind: "empty";
      key: "empty";
    }
  | {
      kind: "item";
      key: string;
      block: Extract<MessageStreamLayoutBlock, { type: "item" }>;
    }
  | {
      kind: "activityGroup";
      key: string;
      block: Extract<MessageStreamLayoutBlock, { type: "activityGroup" }>;
    }
  | {
      kind: "liveTask";
      key: string;
      item: TaskProgressMessageStreamItem;
    }
  | {
      kind: "liveAgentSummary";
      key: string;
      summary: AgentRunSummary;
    };

export function messageStreamPresentationBlocks(input: MessageStreamPresentationBlockInput): MessageStreamPresentationBlock[] {
  const blocks: MessageStreamPresentationBlock[] = [];

  if (input.activeThreadId && input.historyCursor) {
    blocks.push({ kind: "historyBar", key: "history-bar", loadingHistory: input.loadingHistory });
  }

  if (messageStreamBlockItemsEmpty(input)) {
    blocks.push({ kind: "empty", key: "empty" });
    return blocks;
  }

  for (const block of layoutBlocksForInput(input)) {
    if (block.type === "item") {
      blocks.push({ kind: "item", key: `item:${block.item.id}`, block });
    } else {
      blocks.push({ kind: "activityGroup", key: `activity:${block.id}`, block });
    }
  }

  if (input.activeTurnId) blocks.push(...activeTurnLiveBlocks(input, input.activeTurnId));

  return blocks;
}

function messageStreamBlockItemsEmpty(input: MessageStreamPresentationBlockInput): boolean {
  if (!input.stableItems && !input.activeItems) return input.items.length === 0;
  return (input.stableItems?.length ?? 0) === 0 && (input.activeItems?.length ?? 0) === 0;
}

function layoutBlocksForInput(input: MessageStreamPresentationBlockInput): MessageStreamLayoutBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId || !input.stableItems || !input.activeItems) {
    const streamItems = activeTurnId ? withoutActiveTaskProgress(input.items, activeTurnId) : input.items;
    return messageStreamLayoutBlocks(streamItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  }
  const stableBlocks = messageStreamLayoutBlocks(input.stableItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  const activeBlocks = messageStreamLayoutBlocks(
    withoutActiveTaskProgress(input.activeItems, activeTurnId),
    activeTurnId,
    input.workspaceRoot,
    input.turnDiffs,
  );
  return [...stableBlocks, ...activeBlocks];
}

function activeTurnLiveBlocks(
  input: Pick<MessageStreamPresentationBlockInput, "items" | "activeItems">,
  activeTurnId: string,
): MessageStreamPresentationBlock[] {
  const items = input.activeItems ?? input.items;
  const semanticItems = messageStreamSemanticClassifications(items);
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(semanticItems, activeTurnId);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummary(items, activeTurnId) : null;

  return semanticItems.flatMap((classification): MessageStreamPresentationBlock[] => {
    const { item } = classification;
    if (messageStreamIsTaskProgress(classification) && item.turnId === activeTurnId) {
      return [
        {
          kind: "liveTask",
          key: `live-task:${item.id}`,
          item: taskProgressStreamItem(item),
        },
      ];
    }
    if (item.id === agentSummaryAnchorId) {
      return agentSummary ? [{ kind: "liveAgentSummary", key: `live-agents:${activeTurnId}`, summary: agentSummary }] : [];
    }
    return [];
  });
}

function activeAgentRunSummaryAnchorId(items: readonly MessageStreamSemanticClassification[], activeTurnId: string): string | null {
  const firstActiveAgent = items.find(
    (classification) => messageStreamIsCoordinationProgress(classification) && classification.item.turnId === activeTurnId,
  );
  return firstActiveAgent?.item.id ?? null;
}

function taskProgressStreamItem(item: MessageStreamItem): TaskProgressMessageStreamItem {
  if (item.kind !== "taskProgress") throw new Error(`Expected task progress presentation item for ${item.id}`);
  return item;
}

function withoutActiveTaskProgress(items: readonly MessageStreamItem[], activeTurnId: string): MessageStreamItem[] {
  return items.filter((item) => item.kind !== "taskProgress" || item.turnId !== activeTurnId);
}
