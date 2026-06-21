import type { MessageStreamSemanticClassification } from "../../domain/message-stream/semantics/types";
import type { AgentRunSummary, MessageStreamItem, TaskProgressMessageStreamItem } from "../../domain/message-stream/items";
import { activeTurnLiveItems, messageStreamItemsWithoutActiveTaskProgress } from "../../domain/message-stream/semantics/active-turn";
import { messageStreamLayoutBlocks, type MessageStreamItemAnnotations, type MessageStreamLayoutBlock } from "./layout";
import { detailView, type DetailView } from "./detail-view";
import { messageStreamTextView, type MessageStreamTextActionTargets, type MessageStreamTextView } from "./text-view";
import { agentRunSummaryView, messageStreamStatusView, type AgentRunSummaryView, type MessageStreamStatusView } from "./status-view";
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
  textActionTargetsByItemId?: ReadonlyMap<string, MessageStreamTextActionTargets> | undefined;
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

type MessageStreamPresentationBlockSource = (input: MessageStreamPresentationBlockInput) => readonly MessageStreamPresentationBlock[];
type MessageStreamRenderFamily = "text" | "detail" | "status";

export type MessageStreamRenderedItemView =
  | {
      kind: "text";
      view: MessageStreamTextView;
    }
  | {
      kind: "detail";
      view: DetailView;
    }
  | {
      kind: "status";
      view: MessageStreamStatusView;
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
  const headerBlocks = historyPresentationBlocks(input);
  if (messageStreamBlockItemsEmpty(input)) {
    return [...headerBlocks, { kind: "empty", key: "empty" }];
  }

  return [
    ...headerBlocks,
    ...collectPresentationBlocks(input, [layoutPresentationBlocks, activeTurnPresentationBlocks, pendingRequestPresentationBlocks]),
  ];
}

function collectPresentationBlocks(
  input: MessageStreamPresentationBlockInput,
  sources: readonly MessageStreamPresentationBlockSource[],
): MessageStreamPresentationBlock[] {
  return sources.flatMap((source) => source(input));
}

function historyPresentationBlocks(input: MessageStreamPresentationBlockInput): readonly MessageStreamPresentationBlock[] {
  if (!input.activeThreadId || !input.historyCursor) return [];
  return [{ kind: "historyBar", key: "history-bar", loadingHistory: input.loadingHistory }];
}

function layoutPresentationBlocks(input: MessageStreamPresentationBlockInput): readonly MessageStreamPresentationBlock[] {
  return layoutBlocksForInput(input).map(presentationBlockFromLayoutBlock);
}

function presentationBlockFromLayoutBlock(block: MessageStreamLayoutBlock): MessageStreamPresentationBlock {
  if (block.type === "item") return { kind: "item", key: `item:${block.item.id}`, block };
  return { kind: "activityGroup", key: `activity:${block.id}`, block };
}

function activeTurnPresentationBlocks(input: MessageStreamPresentationBlockInput): readonly MessageStreamPresentationBlock[] {
  if (!input.activeTurnId) return [];
  return activeTurnLiveBlocks(input, input.activeTurnId);
}

function pendingRequestPresentationBlocks(input: MessageStreamPresentationBlockInput): readonly MessageStreamPresentationBlock[] {
  if (!input.pendingRequests?.signature) return [];
  return [
    {
      kind: "pendingRequests",
      key: "pending-requests",
      signature: input.pendingRequests.signature,
      snapshot: input.pendingRequests.snapshot,
    },
  ];
}

function messageStreamBlockItemsEmpty(input: MessageStreamPresentationBlockInput): boolean {
  if (!input.stableItems && !input.activeItems) return input.items.length === 0;
  return (input.stableItems?.length ?? 0) === 0 && (input.activeItems?.length ?? 0) === 0;
}

function layoutBlocksForInput(input: MessageStreamPresentationBlockInput): MessageStreamLayoutBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId || !input.stableItems || !input.activeItems) {
    const streamItems = activeTurnId ? messageStreamItemsWithoutActiveTaskProgress(input.items, activeTurnId) : input.items;
    return messageStreamLayoutBlocks(streamItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  }
  const stableBlocks = messageStreamLayoutBlocks(input.stableItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  const activeBlocks = messageStreamLayoutBlocks(
    messageStreamItemsWithoutActiveTaskProgress(input.activeItems, activeTurnId),
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
  return activeTurnLiveItems(input, activeTurnId).map((item): MessageStreamPresentationBlock => {
    if (item.kind === "taskProgress") {
      return {
        kind: "liveTask",
        key: `live-task:${item.item.id}`,
        item: item.item,
      };
    }
    return { kind: "liveAgentSummary", key: `live-agents:${activeTurnId}`, summary: item.summary };
  });
}

function messageStreamViewBlockFromPresentationBlock(
  block: MessageStreamPresentationBlock,
  input: MessageStreamPresentationBlockInput,
): MessageStreamViewBlock {
  if (block.kind === "historyBar" || block.kind === "empty") return block;
  if (block.kind === "pendingRequests") return block;
  if (block.kind === "liveAgentSummary") return { kind: "liveAgentSummary", key: block.key, view: agentRunSummaryView(block.summary) };
  if (block.kind === "liveTask") {
    return { kind: "status", key: block.key, view: messageStreamStatusView(block.item, statusViewContext(input)) };
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
  switch (renderFamily) {
    case "text":
      return {
        kind: "text",
        view: messageStreamTextView(classification.item, annotations, {
          activeTurnId: input.activeTurnId,
          ...definedProp("actionTargets", input.textActionTargetsByItemId?.get(classification.item.id)),
        }),
      };
    case "detail":
      return { kind: "detail", view: detailView(classification.item, input.workspaceRoot) };
    case "status":
      return { kind: "status", view: messageStreamStatusView(classification.item, statusViewContext(input)) };
  }
}

function messageStreamRenderFamily(classification: MessageStreamSemanticClassification): MessageStreamRenderFamily {
  switch (classification.item.kind) {
    case "message":
    case "system":
    case "userInputResult":
      return "text";
    case "command":
    case "fileChange":
    case "tool":
    case "hook":
    case "goal":
    case "approvalResult":
    case "reviewResult":
    case "agent":
      return "detail";
    case "taskProgress":
    case "reasoning":
    case "wait":
    case "contextCompaction":
      return "status";
  }
  return "status";
}

function statusViewContext(input: MessageStreamPresentationBlockInput): Parameters<typeof messageStreamStatusView>[1] {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
