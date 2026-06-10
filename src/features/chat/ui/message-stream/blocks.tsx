import { Fragment, type ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

import { activeTurnId } from "../../chat-state";
import { displayBlocksForItems } from "../../display/blocks";
import type { ToolResultDisplayItem } from "../../display/tool-view";
import type { DisplayBlock, DisplayItem } from "../../display/types";
import { userInputDraftKey, userInputOtherDraftKey } from "../../requests/user-input";
import { pendingRequestMessageNode } from "../pending-request-message";
import { toolResultNode } from "../tool-result";
import { activeAgentRunSummaryBlock, agentRunSummaryNode, workItemNode, type WorkItemDisplayItem } from "../work-items";
import type { MessageStreamBlock, MessageStreamContext, RenderableTextItem } from "./context";
import { messageItemNode } from "./message-item";

function messageStreamActiveTurnId(context: Pick<MessageStreamContext, "turnLifecycle">): string | null {
  return activeTurnId({ lifecycle: context.turnLifecycle });
}

function isRenderableTextItem(item: DisplayItem): item is RenderableTextItem {
  return item.kind === "message" || item.kind === "system" || item.kind === "userInputResult";
}

function isRenderableToolResultItem(item: DisplayItem): item is ToolResultDisplayItem {
  return (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "goal" ||
    item.kind === "tool" ||
    item.kind === "hook" ||
    item.kind === "reviewResult" ||
    item.kind === "approvalResult"
  );
}

function isRenderableWorkItem(item: DisplayItem): item is WorkItemDisplayItem {
  return item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction";
}

function displayItemNode(item: DisplayItem, context: MessageStreamContext): UiNode {
  if (isRenderableTextItem(item)) return messageItemNode(item, context);
  if (isRenderableToolResultItem(item)) return toolResultNode(item, context);
  if (isRenderableWorkItem(item)) return workItemNode(item, context);
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

  if (context.displayItems.length === 0) {
    blocks.push({
      key: "empty",
      node: <EmptyMessage />,
    });
    return blocks;
  }

  const streamItems = activeTurn ? withoutActiveTaskProgress(context.displayItems, activeTurn) : context.displayItems;
  for (const block of displayBlocksForItems(streamItems, activeTurn, context.workspaceRoot, context.turnDiffs)) {
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

function bottomLiveBlocks(context: MessageStreamContext, activeTurn: string | null): MessageStreamBlock[] {
  const blocks: MessageStreamBlock[] = [];
  if (activeTurn) blocks.push(...activeTurnLiveBlocks(context, activeTurn));

  if (context.pendingRequests?.signature) {
    const snapshot = context.pendingRequests.snapshot();
    blocks.push({
      key: "pending-requests",
      node: pendingRequestMessageNode(
        snapshot.approvals,
        snapshot.pendingUserInputs,
        {
          values: snapshot.userInputDrafts,
          draftKey: userInputDraftKey,
          otherDraftKey: userInputOtherDraftKey,
        },
        snapshot.openDetails,
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
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(context.displayItems, activeTurn);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummaryBlock(context) : null;
  const blocks = context.displayItems.flatMap((item): MessageStreamBlock[] => {
    if (item.kind === "taskProgress" && item.turnId === activeTurn) {
      return [
        {
          key: `live-task:${item.id}`,
          node: workItemNode(item, context),
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

function activeAgentRunSummaryAnchorId(items: readonly DisplayItem[], activeTurn: string): string | null {
  const firstActiveAgent = items.find((item) => item.kind === "agent" && item.turnId === activeTurn);
  return firstActiveAgent?.id ?? null;
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
  const detailsKey = `turn:${group.turnId}:activity`;
  const [open, setOpen] = useState(context.openDetails.has(detailsKey));

  useLayoutEffect(() => {
    setOpen(context.openDetails.has(detailsKey));
  }, [context.openDetails, detailsKey]);

  return (
    <details
      className="codex-panel__activity-group"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        context.onDetailsToggle?.(detailsKey, nextOpen);
      }}
    >
      <summary tabIndex={-1}>{group.summary}</summary>
      {group.items.map((item) => (
        <Fragment key={item.id}>{displayItemNode(item, context)}</Fragment>
      ))}
    </details>
  );
}
