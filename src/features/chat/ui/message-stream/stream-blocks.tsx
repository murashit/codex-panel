import { Fragment, type ComponentChild as UiNode } from "preact";

import {
  messageStreamViewHasEmptyBlock,
  type MessageStreamActivityItemView,
  type MessageStreamRenderedItemView,
  type MessageStreamViewBlock,
} from "../../presentation/message-stream/view-model";
import { pendingRequestBlockNode } from "./pending-request-block";
import { toolResultNode } from "./tool-result";
import { agentRunSummaryNode, workItemNode } from "./work-items";
import type { MessageStreamBlock, MessageStreamContext } from "./context";
import { textItemNode } from "./text-item";

function streamItemNode(item: MessageStreamRenderedItemView, context: MessageStreamContext): UiNode {
  if (item.kind === "text") return textItemNode(item.view, context);
  if (item.kind === "toolResult") return toolResultNode(item.view, context);
  return workItemNode(item.view, context);
}

export function messageStreamBlocks(viewBlocks: readonly MessageStreamViewBlock[], context: MessageStreamContext): MessageStreamBlock[] {
  const blocks = viewBlocks.map((block) => presentationBlockNode(block, context));

  if (!messageStreamViewHasEmptyBlock(viewBlocks) && context.pendingRequests?.signature) {
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

function presentationBlockNode(block: MessageStreamViewBlock, context: MessageStreamContext): MessageStreamBlock {
  if (block.kind === "historyBar") {
    return {
      key: block.key,
      node: <HistoryBar loadingHistory={block.loadingHistory} loadOlderTurns={context.loadOlderTurns} />,
    };
  }
  if (block.kind === "empty") {
    return {
      key: block.key,
      node: <EmptyMessage />,
    };
  }
  if (block.kind === "activityGroup") {
    return {
      key: block.key,
      node: <ActivityGroup group={block} context={context} />,
    };
  }
  if (block.kind === "liveAgentSummary") {
    return { key: block.key, node: agentRunSummaryNode(block.view) };
  }
  return { key: block.key, node: streamItemNode(block, context) };
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
  group: Extract<MessageStreamViewBlock, { kind: "activityGroup" }>;
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
      {group.items.map((activity) => (
        <Fragment key={activity.id}>
          {activity.type === "steering" ? <SteeringActivity activity={activity} /> : streamItemNode(activity, context)}
        </Fragment>
      ))}
    </details>
  );
}

function SteeringActivity({ activity }: { activity: Extract<MessageStreamActivityItemView, { type: "steering" }> }): UiNode {
  return (
    <div className="codex-panel__message codex-panel__message--tool codex-panel__tool-item codex-panel__tool-result codex-panel__tool-result--plain">
      <div className="codex-panel__tool-result-header">
        <span className="codex-panel__message-role codex-panel__tool-result-label">{activity.label}</span>
      </div>
      <div className="codex-panel__tool-summary">{activity.text}</div>
    </div>
  );
}
