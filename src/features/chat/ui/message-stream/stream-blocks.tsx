import { Fragment, type ComponentChild as UiNode } from "preact";

import {
  type MessageStreamActivityItemView,
  type MessageStreamRenderedItemView,
  type MessageStreamViewBlock,
} from "../../presentation/message-stream/view-model";
import type { MessageStreamContext, PendingRequestBlockContext } from "./context";
import { detailNode } from "./detail";
import { MessageStreamFlowFrame, type MessageStreamScrollControllerBinding } from "./flow-scroll";
import { pendingRequestBlockNode } from "./pending-request-block";
import { agentRunSummaryNode, statusNode } from "./status";
import { textNode } from "./text";

export interface MessageStreamViewportState {
  blocks: readonly MessageStreamViewBlock[];
  context: MessageStreamContext;
  scrollController: MessageStreamScrollControllerBinding;
}

interface MessageStreamViewportProps {
  state: MessageStreamViewportState;
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
}

export function MessageStreamViewport({ state, rootAttributes }: MessageStreamViewportProps): UiNode {
  const { blocks, context, scrollController } = state;
  return (
    <MessageStreamFlowFrame
      blocks={blocks}
      scrollController={scrollController}
      renderBlockContent={(block) => <MessageStreamBlockContent block={block} context={context} />}
      {...(rootAttributes ? { rootAttributes } : {})}
    />
  );
}

function streamItemNode(item: MessageStreamRenderedItemView, context: MessageStreamContext): UiNode {
  if (item.kind === "text") return textNode(item.view, context);
  if (item.kind === "detail") return detailNode(item.view, context);
  return statusNode(item.view);
}

function MessageStreamBlockContent({ block, context }: { block: MessageStreamViewBlock; context: MessageStreamContext }): UiNode {
  return presentationBlockNode(block, context);
}

function presentationBlockNode(block: MessageStreamViewBlock, context: MessageStreamContext): UiNode {
  if (block.kind === "historyBar") {
    return <HistoryBar loadingHistory={block.loadingHistory} loadOlderTurns={context.loadOlderTurns} />;
  }
  if (block.kind === "empty") {
    return <EmptyMessage />;
  }
  if (block.kind === "activityGroup") {
    return <ActivityGroup group={block} context={context} />;
  }
  if (block.kind === "liveAgentSummary") {
    return agentRunSummaryNode(block.view);
  }
  if (block.kind === "pendingRequests") {
    const pendingRequests = pendingRequestContext(context);
    return pendingRequestBlockNode(
      block.snapshot.approvals,
      block.snapshot.pendingUserInputs,
      block.snapshot.pendingMcpElicitations,
      block.snapshot.userInputDrafts,
      block.snapshot.mcpElicitationDrafts,
      block.snapshot.approvalDetails,
      pendingRequests.actions(),
      false,
      pendingRequests.consumeAutoFocus,
      block.signature,
    );
  }
  return streamItemNode(block, context);
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
