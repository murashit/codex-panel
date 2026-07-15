import type { ThreadStreamItem } from "../../domain/thread-stream/items";
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
  const headerBlocks = historyViewBlocks(input);
  if (threadStreamItemsEmpty(input)) {
    return [...headerBlocks, { kind: "empty", key: "empty" }];
  }

  return [...headerBlocks, ...layoutViewBlocks(input), ...activeTurnViewBlocks(input), ...pendingRequestViewBlocks(input)];
}

function historyViewBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamViewBlock[] {
  if (!input.activeThreadId || !input.historyCursor) return [];
  return [{ kind: "historyBar", key: "history-bar", loadingHistory: input.loadingHistory }];
}

function layoutViewBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamViewBlock[] {
  return layoutBlocksForInput(input).map((block) => threadStreamViewBlockFromLayoutBlock(block, input));
}

function threadStreamViewBlockFromLayoutBlock(
  block: ThreadStreamLayoutBlock,
  input: ThreadStreamPresentationBlockInput,
): ThreadStreamViewBlock {
  if (block.type === "item") {
    return {
      key: `item:${block.item.id}`,
      ...threadStreamRenderedItemView(block.classification, input, block.annotations),
    };
  }
  return {
    kind: "activityGroup",
    key: `activity:${block.id}`,
    id: block.id,
    turnId: block.turnId,
    summary: block.summary,
    items: block.items.map((activity) => threadStreamActivityItemView(activity, input)),
  };
}

function activeTurnViewBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamViewBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId) return [];
  return activeTurnLiveItems(input, activeTurnId).map((item): ThreadStreamViewBlock => {
    if (item.kind === "taskProgress") {
      return {
        kind: "status",
        key: `live-task:${item.item.id}`,
        view: threadStreamStatusView(item.item, statusViewContext(input)),
      };
    }
    return {
      kind: "liveAgentSummary",
      key: `live-agents:${activeTurnId}`,
      view: agentRunSummaryView(item.summary),
    };
  });
}

function pendingRequestViewBlocks(input: ThreadStreamPresentationBlockInput): readonly ThreadStreamViewBlock[] {
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
