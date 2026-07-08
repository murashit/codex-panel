import type { AgentRunSummary, TaskProgressThreadStreamItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import { threadStreamItemsEmpty } from "../../domain/thread-stream/selectors";
import { activeTurnLiveItems, threadStreamItemsWithoutActiveTaskProgress } from "../../domain/thread-stream/semantics/active-turn";
import type { ThreadStreamSemanticClassification } from "../../domain/thread-stream/semantics/types";
import type { PendingRequestBlockSnapshot } from "../pending-requests/view-model";
import { type DetailView, detailView } from "./detail-view";
import { type ThreadStreamItemAnnotations, type ThreadStreamLayoutBlock, threadStreamLayoutBlocks } from "./layout";
import { type AgentRunSummaryView, agentRunSummaryView, type ThreadStreamStatusView, threadStreamStatusView } from "./status-view";
import { type ThreadStreamTextActionTargets, type ThreadStreamTextView, threadStreamTextView } from "./text-view";

interface PendingRequestThreadStreamBlockInput {
  signature: string;
  snapshot: PendingRequestBlockSnapshot;
}

export interface ThreadStreamPresentationBlockInput {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  items: readonly ThreadStreamItem[];
  stableItems?: readonly ThreadStreamItem[] | undefined;
  activeItems?: readonly ThreadStreamItem[] | undefined;
  workspaceRoot?: string | null | undefined;
  turnDiffs?: ReadonlyMap<string, string> | undefined;
  textActionTargetsByItemId?: ReadonlyMap<string, ThreadStreamTextActionTargets> | undefined;
  pendingRequests?: PendingRequestThreadStreamBlockInput | null | undefined;
}

type ThreadStreamPresentationBlock =
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
      block: Extract<ThreadStreamLayoutBlock, { type: "item" }>;
    }
  | {
      kind: "activityGroup";
      key: string;
      block: Extract<ThreadStreamLayoutBlock, { type: "activityGroup" }>;
    }
  | {
      kind: "liveTask";
      key: string;
      item: TaskProgressThreadStreamItem;
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

type ThreadStreamPresentationBlockSource = (input: ThreadStreamPresentationBlockInput) => readonly ThreadStreamPresentationBlock[];
type ThreadStreamRenderFamily = "text" | "detail" | "status";

export type ThreadStreamRenderedItemView =
  | {
      kind: "text";
      view: ThreadStreamTextView;
    }
  | {
      kind: "detail";
      view: DetailView;
    }
  | {
      kind: "status";
      view: ThreadStreamStatusView;
    };

export type ThreadStreamActivityItemView =
  | ({
      type: "item";
      id: string;
    } & ThreadStreamRenderedItemView)
  | {
      type: "steering";
      id: string;
      label: string;
      text: string;
      sourceItemId: string;
    };

export type ThreadStreamViewBlock =
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
    } & ThreadStreamRenderedItemView)
  | {
      kind: "activityGroup";
      key: string;
      id: string;
      turnId: string;
      summary: string;
      items: ThreadStreamActivityItemView[];
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

export function threadStreamViewBlocks(input: ThreadStreamPresentationBlockInput): ThreadStreamViewBlock[] {
  return threadStreamPresentationBlocks(input).map((block) => threadStreamViewBlockFromPresentationBlock(block, input));
}

function threadStreamPresentationBlocks(input: ThreadStreamPresentationBlockInput): ThreadStreamPresentationBlock[] {
  const headerBlocks = historyPresentationBlocks(input);
  if (threadStreamItemsEmpty(input)) {
    return [...headerBlocks, { kind: "empty", key: "empty" }];
  }

  return [
    ...headerBlocks,
    ...collectPresentationBlocks(input, [layoutPresentationBlocks, activeTurnPresentationBlocks, pendingRequestPresentationBlocks]),
  ];
}

function collectPresentationBlocks(
  input: ThreadStreamPresentationBlockInput,
  sources: readonly ThreadStreamPresentationBlockSource[],
): ThreadStreamPresentationBlock[] {
  return sources.flatMap((source) => source(input));
}

function historyPresentationBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamPresentationBlock[] {
  if (!input.activeThreadId || !input.historyCursor) return [];
  return [{ kind: "historyBar", key: "history-bar", loadingHistory: input.loadingHistory }];
}

function layoutPresentationBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamPresentationBlock[] {
  return layoutBlocksForInput(input).map(presentationBlockFromLayoutBlock);
}

function presentationBlockFromLayoutBlock(block: ThreadStreamLayoutBlock): ThreadStreamPresentationBlock {
  if (block.type === "item") return { kind: "item", key: `item:${block.item.id}`, block };
  return { kind: "activityGroup", key: `activity:${block.id}`, block };
}

function activeTurnPresentationBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamPresentationBlock[] {
  if (!input.activeTurnId) return [];
  return activeTurnLiveBlocks(input, input.activeTurnId);
}

function pendingRequestPresentationBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamPresentationBlock[] {
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

function layoutBlocksForInput(input: ThreadStreamPresentationBlockInput): ThreadStreamLayoutBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId || !input.stableItems || !input.activeItems) {
    const streamItems = activeTurnId ? threadStreamItemsWithoutActiveTaskProgress(input.items, activeTurnId) : input.items;
    return threadStreamLayoutBlocks(streamItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  }
  const stableBlocks = threadStreamLayoutBlocks(input.stableItems, activeTurnId, input.workspaceRoot, input.turnDiffs);
  const activeBlocks = threadStreamLayoutBlocks(
    threadStreamItemsWithoutActiveTaskProgress(input.activeItems, activeTurnId),
    activeTurnId,
    input.workspaceRoot,
    input.turnDiffs,
  );
  return [...stableBlocks, ...activeBlocks];
}

function activeTurnLiveBlocks(
  input: Pick<ThreadStreamPresentationBlockInput, "items" | "activeItems">,
  activeTurnId: string,
): ThreadStreamPresentationBlock[] {
  return activeTurnLiveItems(input, activeTurnId).map((item): ThreadStreamPresentationBlock => {
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

function threadStreamViewBlockFromPresentationBlock(
  block: ThreadStreamPresentationBlock,
  input: ThreadStreamPresentationBlockInput,
): ThreadStreamViewBlock {
  if (block.kind === "historyBar" || block.kind === "empty") return block;
  if (block.kind === "pendingRequests") return block;
  if (block.kind === "liveAgentSummary") return { kind: "liveAgentSummary", key: block.key, view: agentRunSummaryView(block.summary) };
  if (block.kind === "liveTask") {
    return { kind: "status", key: block.key, view: threadStreamStatusView(block.item, statusViewContext(input)) };
  }
  if (block.kind === "activityGroup") {
    return {
      kind: "activityGroup",
      key: block.key,
      id: block.block.id,
      turnId: block.block.turnId,
      summary: block.block.summary,
      items: block.block.items.map((activity) => threadStreamActivityItemView(activity, input)),
    };
  }
  return { key: block.key, ...threadStreamRenderedItemView(block.block.classification, input, block.block.annotations) };
}

function threadStreamActivityItemView(
  activity: Extract<ThreadStreamLayoutBlock, { type: "activityGroup" }>["items"][number],
  input: ThreadStreamPresentationBlockInput,
): ThreadStreamActivityItemView {
  if (activity.type === "steering") return activity;
  return { type: "item", id: activity.id, ...threadStreamRenderedItemView(activity.classification, input) };
}

function threadStreamRenderedItemView(
  classification: ThreadStreamSemanticClassification,
  input: ThreadStreamPresentationBlockInput,
  annotations?: ThreadStreamItemAnnotations,
): ThreadStreamRenderedItemView {
  const renderFamily = threadStreamRenderFamily(classification);
  switch (renderFamily) {
    case "text":
      return {
        kind: "text",
        view: threadStreamTextView(classification.item, annotations, {
          activeTurnId: input.activeTurnId,
          ...definedProp("actionTargets", input.textActionTargetsByItemId?.get(classification.item.id)),
        }),
      };
    case "detail":
      return { kind: "detail", view: detailView(classification.item, input.workspaceRoot) };
    case "status":
      return { kind: "status", view: threadStreamStatusView(classification.item, statusViewContext(input)) };
  }
}

function threadStreamRenderFamily(classification: ThreadStreamSemanticClassification): ThreadStreamRenderFamily {
  switch (classification.item.kind) {
    case "dialogue":
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

function statusViewContext(input: ThreadStreamPresentationBlockInput): Parameters<typeof threadStreamStatusView>[1] {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
