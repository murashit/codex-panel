import { Fragment, type ComponentChild as UiNode } from "preact";

import {
  type MessageStreamActivityItemView,
  type MessageStreamRenderedItemView,
  type MessageStreamViewBlock,
} from "../../presentation/message-stream/view-model";
import { pendingRequestBlockNode } from "./pending-request-block";
import { detailNode } from "./detail";
import { agentRunSummaryNode, statusItemNode } from "./status-items";
import type { MessageStreamBlock, MessageStreamContext, PendingRequestBlockContext } from "./context";
import { textItemNode } from "./text-item";

function streamItemNode(item: MessageStreamRenderedItemView, context: MessageStreamContext): UiNode {
  if (item.kind === "text") return textItemNode(item.view, context);
  if (item.kind === "detail") return detailNode(item.view, context);
  return statusItemNode(item.view);
}

export function messageStreamBlocks(viewBlocks: readonly MessageStreamViewBlock[], context: MessageStreamContext): MessageStreamBlock[] {
  return viewBlocks.map((block) => presentationBlockNode(block, context));
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
  if (block.kind === "pendingRequests") {
    const pendingRequests = pendingRequestContext(context);
    return {
      key: block.key,
      node: pendingRequestBlockNode(
        block.snapshot.approvals,
        block.snapshot.pendingUserInputs,
        block.snapshot.userInputDrafts,
        block.snapshot.approvalDetails,
        pendingRequests.actions(),
        false,
        pendingRequests.consumeAutoFocus,
        block.signature,
      ),
    };
  }
  return { key: block.key, node: streamItemNode(block, context) };
}

function pendingRequestContext(context: MessageStreamContext): PendingRequestBlockContext {
  if (!context.pendingRequests) throw new Error("Expected pending request context for pending request block.");
  return context.pendingRequests;
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
    <div className="codex-panel__message codex-panel__message--tool codex-panel__detail-item codex-panel__detail codex-panel__detail--plain">
      <div className="codex-panel__detail-header">
        <span className="codex-panel__message-role codex-panel__detail-label">{activity.label}</span>
      </div>
      <div className="codex-panel__stream-summary">{activity.text}</div>
    </div>
  );
}
