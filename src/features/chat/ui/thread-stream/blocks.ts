import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { threadStreamSegmentsEmpty } from "../../domain/thread-stream/selectors";
import { activeTurnLiveItems, threadStreamItemsWithoutActiveTaskProgress } from "../../domain/thread-stream/semantics/active-turn";
import type { ActiveSubagentActivity } from "../../domain/thread-stream/semantics/agent-run-summary";
import { detailView } from "./detail-view";
import { type ThreadStreamItemAnnotations, type ThreadStreamLayoutBlock, threadStreamLayoutBlocks } from "./layout";
import type {
  ThreadStreamActivityItemView,
  ThreadStreamRenderedItemView,
  ThreadStreamTextActionTargets,
  ThreadStreamViewBlock,
} from "./model";
import type { PendingRequestBlockProjection } from "./pending-requests";
import { agentRunSummaryView, type ThreadStreamStatusViewContext, threadStreamStatusView } from "./status-view";
import { threadStreamTextView } from "./text";

interface ThreadStreamBlockProjectionInput {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  referenceTitles?: ReadonlyMap<string, string>;
  items: readonly ThreadStreamItem[];
  stableItems: readonly ThreadStreamItem[];
  activeItems: readonly ThreadStreamItem[];
  workspaceRoot: string;
  turnDiffs: ReadonlyMap<string, string>;
  textActionTargetsByItemId: ReadonlyMap<string, ThreadStreamTextActionTargets>;
  pendingRequests: PendingRequestBlockProjection | null;
  subagentActivities: ReadonlyMap<string, ActiveSubagentActivity>;
  authRecovery: { readonly message: string; readonly phase: "running" | "completed" } | null;
}

type ThreadStreamRenderFamily = "text" | "detail" | "status";

export function threadStreamViewBlocks(input: ThreadStreamBlockProjectionInput): ThreadStreamViewBlock[] {
  if (input.referenceTitles) {
    input = {
      ...input,
      items: resolvedReferenceTitles(input.items, input.referenceTitles),
      stableItems: resolvedReferenceTitles(input.stableItems, input.referenceTitles),
      activeItems: resolvedReferenceTitles(input.activeItems, input.referenceTitles),
    };
  }
  const headerBlocks = historyViewBlocks(input);
  if (threadStreamSegmentsEmpty(input.stableItems, input.activeItems) && !input.authRecovery) {
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
      key: threadStreamItemViewKey(block.item),
      ...threadStreamRenderedItemView(block.item, input, block.annotations),
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

function threadStreamItemViewKey(item: ThreadStreamItem): string {
  return `item:${
    item.kind === "dialogue" && item.role === "user" && item.clientId ? `${item.turnId ?? "unscoped"}:${item.clientId}` : item.id
  }`;
}

function activeTurnViewBlocks(input: ThreadStreamBlockProjectionInput): readonly ThreadStreamViewBlock[] {
  const { activeTurnId } = input;
  if (!activeTurnId) return [];
  const liveBlocks = activeTurnLiveItems(input, activeTurnId).map((item): ThreadStreamViewBlock => {
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
  const authRecovery = input.authRecovery;
  return authRecovery
    ? [
        ...liveBlocks,
        {
          kind: "status",
          key: `live-auth-recovery:${activeTurnId}`,
          view: {
            kind: "generic",
            label: "auth",
            className: "codex-panel__status-item",
            state: authRecovery.phase,
            text: authRecovery.message,
          },
        },
      ]
    : liveBlocks;
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
  return { type: "item", id: activity.id, ...threadStreamRenderedItemView(activity.item, input) };
}

function threadStreamRenderedItemView(
  item: ThreadStreamItem,
  input: ThreadStreamBlockProjectionInput,
  annotations?: ThreadStreamItemAnnotations,
): ThreadStreamRenderedItemView {
  const renderFamily = threadStreamRenderFamily(item);
  switch (renderFamily) {
    case "text":
      return {
        kind: "text",
        view: threadStreamTextView(item, annotations, {
          activeTurnId: input.activeTurnId,
          ...definedProp("actionTargets", input.textActionTargetsByItemId.get(item.id)),
        }),
      };
    case "detail":
      return { kind: "detail", view: detailView(item, input.workspaceRoot) };
    case "status":
      return { kind: "status", view: threadStreamStatusView(item, statusViewContext(input)) };
  }
}

function threadStreamRenderFamily(item: ThreadStreamItem): ThreadStreamRenderFamily {
  switch (item.kind) {
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

function statusViewContext(input: ThreadStreamBlockProjectionInput): ThreadStreamStatusViewContext {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}

function resolvedReferenceTitles(
  items: readonly ThreadStreamItem[],
  titleByThreadId: ReadonlyMap<string, string>,
): readonly ThreadStreamItem[] {
  return items.map((item) => {
    if (item.kind !== "dialogue" || !item.referencedThread) return item;
    const title = titleByThreadId.get(item.referencedThread.threadId);
    return title ? { ...item, referencedThread: { ...item.referencedThread, title } } : item;
  });
}
