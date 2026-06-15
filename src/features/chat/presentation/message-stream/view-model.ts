import { activeAgentRunSummary } from "./agent-summary";
import { messageStreamRenderFamily } from "../../domain/message-stream/semantics";
import {
  messageStreamIsCoordinationProgress,
  messageStreamIsTaskProgress,
  messageStreamSemanticClassifications,
  type MessageStreamSemanticClassification,
} from "../../domain/message-stream/semantics";
import type { AgentRunSummary, MessageStreamItem, TaskProgressMessageStreamItem } from "../../domain/message-stream/items";
import { messageStreamLayoutBlocks, type MessageStreamItemAnnotations, type MessageStreamLayoutBlock } from "./layout";
import { messageStreamTextView, type MessageStreamTextView, type TextMessageStreamItem } from "./text-view";
import { toolResultView, type ToolResultMessageStreamItem, type ToolResultView } from "./tool-result-view";
import {
  agentRunSummaryView,
  messageStreamWorkView,
  type AgentRunSummaryView,
  type MessageStreamWorkView,
  type WorkMessageStreamItem,
} from "./work-view";
import type { PendingRequestBlockSnapshot } from "../pending-requests/snapshot";

interface PendingRequestMessageStreamBlockInput {
  signature: string;
  snapshot: PendingRequestBlockSnapshot;
}

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
  pendingRequests?: PendingRequestMessageStreamBlockInput | null | undefined;
}

type MessageStreamPresentationBlock =
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
    }
  | {
      kind: "pendingRequests";
      key: "pending-requests";
      signature: string;
      snapshot: PendingRequestBlockSnapshot;
    };

export type MessageStreamRenderedItemView =
  | {
      kind: "text";
      view: MessageStreamTextView;
    }
  | {
      kind: "toolResult";
      view: ToolResultView;
    }
  | {
      kind: "work";
      view: MessageStreamWorkView;
    };

export type MessageStreamActivityItemView =
  | ({
      type: "item";
      id: string;
    } & MessageStreamRenderedItemView)
  | {
      type: "steering";
      id: string;
      label: string;
      text: string;
      sourceItemId: string;
    };

export type MessageStreamViewBlock =
  | {
      kind: "historyBar";
      key: "history-bar";
      loadingHistory: boolean;
    }
  | {
      kind: "empty";
      key: "empty";
    }
  | ({
      key: string;
    } & MessageStreamRenderedItemView)
  | {
      kind: "activityGroup";
      key: string;
      id: string;
      turnId: string;
      summary: string;
      items: MessageStreamActivityItemView[];
    }
  | {
      kind: "liveAgentSummary";
      key: string;
      view: AgentRunSummaryView;
    }
  | {
      kind: "pendingRequests";
      key: "pending-requests";
      signature: string;
      snapshot: PendingRequestBlockSnapshot;
    };

export function messageStreamViewBlocks(input: MessageStreamPresentationBlockInput): MessageStreamViewBlock[] {
  return messageStreamPresentationBlocks(input).map((block) => messageStreamViewBlockFromPresentationBlock(block, input));
}

function messageStreamPresentationBlocks(input: MessageStreamPresentationBlockInput): MessageStreamPresentationBlock[] {
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
  if (input.pendingRequests?.signature) {
    blocks.push({
      kind: "pendingRequests",
      key: "pending-requests",
      signature: input.pendingRequests.signature,
      snapshot: input.pendingRequests.snapshot,
    });
  }

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

function messageStreamViewBlockFromPresentationBlock(
  block: MessageStreamPresentationBlock,
  input: MessageStreamPresentationBlockInput,
): MessageStreamViewBlock {
  if (block.kind === "historyBar" || block.kind === "empty") return block;
  if (block.kind === "pendingRequests") return block;
  if (block.kind === "liveAgentSummary") return { kind: "liveAgentSummary", key: block.key, view: agentRunSummaryView(block.summary) };
  if (block.kind === "liveTask") {
    return { kind: "work", key: block.key, view: messageStreamWorkView(block.item, workViewContext(input)) };
  }
  if (block.kind === "activityGroup") {
    return {
      kind: "activityGroup",
      key: block.key,
      id: block.block.id,
      turnId: block.block.turnId,
      summary: block.block.summary,
      items: block.block.items.map((activity) => messageStreamActivityItemView(activity, input)),
    };
  }
  return { key: block.key, ...messageStreamRenderedItemView(block.block.classification, input, block.block.annotations) };
}

function messageStreamActivityItemView(
  activity: Extract<MessageStreamLayoutBlock, { type: "activityGroup" }>["items"][number],
  input: MessageStreamPresentationBlockInput,
): MessageStreamActivityItemView {
  if (activity.type === "steering") return activity;
  return { type: "item", id: activity.id, ...messageStreamRenderedItemView(activity.classification, input) };
}

function messageStreamRenderedItemView(
  classification: MessageStreamSemanticClassification,
  input: MessageStreamPresentationBlockInput,
  annotations?: MessageStreamItemAnnotations,
): MessageStreamRenderedItemView {
  const renderFamily = messageStreamRenderFamily(classification);
  if (renderFamily === "text") return { kind: "text", view: messageStreamTextView(textItemFromSemantic(classification), annotations) };
  if (renderFamily === "toolResult") {
    return { kind: "toolResult", view: toolResultView(toolResultItemFromSemantic(classification), input.workspaceRoot) };
  }
  if (renderFamily === "work")
    return { kind: "work", view: messageStreamWorkView(workItemFromSemantic(classification), workViewContext(input)) };
  return unhandledClassification(classification);
}

function workViewContext(input: MessageStreamPresentationBlockInput): Parameters<typeof messageStreamWorkView>[1] {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
}

function textItemFromSemantic({ item }: MessageStreamSemanticClassification): TextMessageStreamItem {
  if (item.kind === "message" || item.kind === "system" || item.kind === "userInputResult") return item;
  throw new Error(`Message stream semantic expected text item: ${JSON.stringify(item)}`);
}

function toolResultItemFromSemantic({ item }: MessageStreamSemanticClassification): ToolResultMessageStreamItem {
  if (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "goal" ||
    item.kind === "tool" ||
    item.kind === "hook" ||
    item.kind === "approvalResult" ||
    item.kind === "reviewResult"
  ) {
    return item;
  }
  throw new Error(`Message stream semantic expected tool result item: ${JSON.stringify(item)}`);
}

function workItemFromSemantic({ item }: MessageStreamSemanticClassification): WorkMessageStreamItem {
  if (item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction") return item;
  throw new Error(`Message stream semantic expected work item: ${JSON.stringify(item)}`);
}

function unhandledClassification(classification: MessageStreamSemanticClassification): never {
  throw new Error(`Unhandled message stream classification: ${JSON.stringify(classification)}`);
}
