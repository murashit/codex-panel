import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { threadStreamSegmentsEmpty } from "../../domain/thread-stream/selectors";
import {
  type ActiveSubagentActivity,
  activeTurnLiveItems,
  threadStreamItemsWithoutActiveTaskProgress,
} from "../../domain/thread-stream/semantics/active-turn";
import type { ThreadStreamSemanticClassification } from "../../domain/thread-stream/semantics/types";
import type {
  PendingRequestBlockSnapshot,
  ThreadStreamActivityItemView,
  ThreadStreamRenderedItemView,
  ThreadStreamTextActionTargets,
  ThreadStreamViewBlock,
} from "../../ui/thread-stream/model";
import { detailView } from "./detail";
import { type ThreadStreamItemAnnotations, type ThreadStreamLayoutBlock, threadStreamLayoutBlocks } from "./layout";
import { agentRunSummaryView, threadStreamStatusView } from "./status";
import { threadStreamTextView } from "./text";

interface PendingRequestThreadStreamBlockInput {
  signature: string;
  snapshot: PendingRequestBlockSnapshot;
}

interface ThreadStreamBlockProjectionInput {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  items: readonly ThreadStreamItem[];
  stableItems: readonly ThreadStreamItem[];
  activeItems: readonly ThreadStreamItem[];
  workspaceRoot: string;
  turnDiffs: ReadonlyMap<string, string>;
  textActionTargetsByItemId: ReadonlyMap<string, ThreadStreamTextActionTargets>;
  pendingRequests: PendingRequestThreadStreamBlockInput | null;
  subagentActivities: ReadonlyMap<string, ActiveSubagentActivity>;
}

type ThreadStreamRenderFamily = "text" | "detail" | "status";

export function threadStreamViewBlocks(input: ThreadStreamBlockProjectionInput): ThreadStreamViewBlock[] {
  const headerBlocks = historyViewBlocks(input);
  if (threadStreamSegmentsEmpty(input.stableItems, input.activeItems)) {
    return [...headerBlocks, { kind: "empty", key: "empty" }];
  }

  return [...headerBlocks, ...layoutViewBlocks(input), ...activeTurnViewBlocks(input), ...pendingRequestViewBlocks(input)];
}

function historyViewBlocks(input: ThreadStreamBlockProjectionInput): readonly ThreadStreamViewBlock[] {
  if (!input.activeThreadId || !input.historyCursor) return [];
  return [{ kind: "historyBar", key: "history-bar", loadingHistory: input.loadingHistory }];
}

function layoutViewBlocks(input: ThreadStreamBlockProjectionInput): readonly ThreadStreamViewBlock[] {
  return layoutBlocksForInput(input).map((block) => threadStreamViewBlockFromLayoutBlock(block, input));
}

function threadStreamViewBlockFromLayoutBlock(
  block: ThreadStreamLayoutBlock,
  input: ThreadStreamBlockProjectionInput,
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

function activeTurnViewBlocks(input: ThreadStreamBlockProjectionInput): readonly ThreadStreamViewBlock[] {
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

function pendingRequestViewBlocks(input: ThreadStreamBlockProjectionInput): readonly ThreadStreamViewBlock[] {
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

function layoutBlocksForInput(input: ThreadStreamBlockProjectionInput): ThreadStreamLayoutBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId) {
    return threadStreamLayoutBlocks(input.stableItems, null, input.workspaceRoot, input.turnDiffs);
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
  input: ThreadStreamBlockProjectionInput,
): ThreadStreamActivityItemView {
  if (activity.type === "steering") return activity;
  return { type: "item", id: activity.id, ...threadStreamRenderedItemView(activity.classification, input) };
}

function threadStreamRenderedItemView(
  classification: ThreadStreamSemanticClassification,
  input: ThreadStreamBlockProjectionInput,
  annotations?: ThreadStreamItemAnnotations,
): ThreadStreamRenderedItemView {
  const renderFamily = threadStreamRenderFamily(classification);
  switch (renderFamily) {
    case "text":
      return {
        kind: "text",
        view: threadStreamTextView(classification.item, annotations, {
          activeTurnId: input.activeTurnId,
          ...definedProp("actionTargets", input.textActionTargetsByItemId.get(classification.item.id)),
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

function statusViewContext(input: ThreadStreamBlockProjectionInput): Parameters<typeof threadStreamStatusView>[1] {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
