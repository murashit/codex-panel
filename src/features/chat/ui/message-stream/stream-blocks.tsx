import { Fragment, type ComponentChild as UiNode } from "preact";

import { activeTurnId } from "../../state/reducer";
import { displayBlocksForItems } from "../../display/stream/blocks";
import type { DisplayBlock, DisplayItem } from "../../display/types";
import { timelineItemFromDisplayItem, timelineItemsFromDisplayItems } from "../../display/timeline/from-display";
import type { TimelineItem } from "../../display/timeline/types";
import { pendingRequestBlockNode } from "./pending-request-block";
import { toolResultNode } from "./tool-result";
import { activeAgentRunSummaryBlock, agentRunSummaryNode, workItemNode } from "./work-items";
import type { MessageStreamBlock, MessageStreamContext } from "./context";
import { textItemNode } from "./text-item";

function messageStreamActiveTurnId(context: Pick<MessageStreamContext, "turnLifecycle">): string | null {
  return activeTurnId({ lifecycle: context.turnLifecycle });
}

function displayItemNode(item: DisplayItem, context: MessageStreamContext): UiNode {
  return timelineItemNode(timelineItemFromDisplayItem(item), context);
}

function timelineItemNode(item: TimelineItem, context: MessageStreamContext): UiNode {
  if (item.renderSurface === "textMessage") return textItemNode(item.displayItem, context);
  if (item.renderSurface === "toolResult") return toolResultNode(item.displayItem, context);
  return workItemNode(item.displayItem, context);
}

export function messageStreamBlocks(context: MessageStreamContext): MessageStreamBlock[] {
  const blocks: MessageStreamBlock[] = [];
  const activeTurn = messageStreamActiveTurnId(context);

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      node: <HistoryBar loadingHistory={context.loadingHistory} loadOlderTurns={context.loadOlderTurns} />,
    });
  }

  if (messageStreamBlockItemsEmpty(context)) {
    blocks.push({
      key: "empty",
      node: <EmptyMessage />,
    });
    return blocks;
  }

  for (const block of displayBlocksForContext(context, activeTurn)) {
    if (block.type === "item") {
      blocks.push({
        key: `item:${block.item.id}`,
        node: displayItemNode(block.item, context),
      });
    } else {
      blocks.push({
        key: `activity:${block.id}`,
        node: <ActivityGroup group={block} context={context} />,
      });
    }
  }

  blocks.push(...bottomLiveBlocks(context, activeTurn));

  return blocks;
}

function messageStreamBlockItemsEmpty(context: MessageStreamContext): boolean {
  if (!context.stableItems && !context.activeItems) return context.displayItems.length === 0;
  return (context.stableItems?.length ?? 0) === 0 && (context.activeItems?.length ?? 0) === 0;
}

function displayBlocksForContext(context: MessageStreamContext, activeTurn: string | null): DisplayBlock[] {
  if (!activeTurn || !context.stableItems || !context.activeItems) {
    const streamItems = activeTurn ? withoutActiveTaskProgress(context.displayItems, activeTurn) : context.displayItems;
    return displayBlocksForItems(streamItems, activeTurn, context.workspaceRoot, context.turnDiffs);
  }
  const stableBlocks = displayBlocksForItems(context.stableItems, activeTurn, context.workspaceRoot, context.turnDiffs);
  const activeBlocks = displayBlocksForItems(
    withoutActiveTaskProgress(context.activeItems, activeTurn),
    activeTurn,
    context.workspaceRoot,
    context.turnDiffs,
  );
  return [...stableBlocks, ...activeBlocks];
}

function bottomLiveBlocks(context: MessageStreamContext, activeTurn: string | null): MessageStreamBlock[] {
  const blocks: MessageStreamBlock[] = [];
  if (activeTurn) blocks.push(...activeTurnLiveBlocks(context, activeTurn));

  if (context.pendingRequests?.signature) {
    const snapshot = context.pendingRequests.snapshot();
    blocks.push({
      key: "pending-requests",
      node: pendingRequestBlockNode(
        snapshot.approvals,
        snapshot.pendingUserInputs,
        snapshot.userInputDrafts,
        snapshot.approvalDetails,
        context.pendingRequests.actions(),
        false,
        context.pendingRequests.consumeAutoFocus,
        context.pendingRequests.signature,
      ),
    });
  }
  return blocks;
}

function activeTurnLiveBlocks(context: MessageStreamContext, activeTurn: string): MessageStreamBlock[] {
  const items = context.activeItems ?? context.displayItems;
  const timelineItems = timelineItemsFromDisplayItems(items);
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(timelineItems, activeTurn);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummaryBlock(context) : null;
  const blocks = timelineItems.flatMap((item): MessageStreamBlock[] => {
    if (item.semanticKind === "taskProgress" && item.turnId === activeTurn) {
      return [
        {
          key: `live-task:${item.id}`,
          node: workItemNode(asWorkItem(item).displayItem, context),
        },
      ];
    }
    if (item.id === agentSummaryAnchorId) {
      return agentSummary
        ? [
            {
              key: `live-agents:${activeTurn}`,
              node: agentRunSummaryNode(agentSummary),
            },
          ]
        : [];
    }
    return [];
  });
  return blocks;
}

function activeAgentRunSummaryAnchorId(items: readonly TimelineItem[], activeTurn: string): string | null {
  const firstActiveAgent = items.find((item) => item.semanticKind === "agentActivity" && item.turnId === activeTurn);
  return firstActiveAgent?.id ?? null;
}

function asWorkItem(item: TimelineItem): Extract<TimelineItem, { renderSurface: "workItem" }> {
  if (item.renderSurface !== "workItem") throw new Error(`Expected work item timeline surface for ${item.id}`);
  return item;
}

function withoutActiveTaskProgress(items: readonly DisplayItem[], activeTurn: string): DisplayItem[] {
  return items.filter((item) => item.kind !== "taskProgress" || item.turnId !== activeTurn);
}

function HistoryBar({ loadingHistory, loadOlderTurns }: { loadingHistory: boolean; loadOlderTurns: () => void }): UiNode {
  return (
    <div className="codex-panel__history-bar">
      <button type="button" disabled={loadingHistory} onClick={loadOlderTurns}>
        {loadingHistory ? "Loading..." : "Load older"}
      </button>
    </div>
  );
}

function EmptyMessage(): UiNode {
  return <div className="codex-panel__message codex-panel__message--system">Send a message to start a conversation.</div>;
}

function ActivityGroup({
  group,
  context,
}: {
  group: Extract<DisplayBlock, { type: "activityGroup" }>;
  context: MessageStreamContext;
}): UiNode {
  const open = context.disclosures.activityGroups.has(group.turnId);

  return (
    <details
      className="codex-panel__activity-group"
      open={open}
      onToggle={(event) => {
        context.onDisclosureToggle?.("activityGroups", group.turnId, event.currentTarget.open);
      }}
    >
      <summary tabIndex={-1}>{group.summary}</summary>
      {group.items.map((item) => (
        <Fragment key={item.id}>{displayItemNode(item, context)}</Fragment>
      ))}
    </details>
  );
}
