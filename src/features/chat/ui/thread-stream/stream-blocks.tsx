import { Fragment, type ComponentChild as UiNode } from "preact";

import type {
  ThreadStreamActivityItemView,
  ThreadStreamRenderedItemView,
  ThreadStreamViewBlock,
} from "../../presentation/thread-stream/view-model";
import type { PendingRequestBlockContext, ThreadStreamContext } from "./context";
import { detailNode } from "./detail";
import { ThreadStreamFlowFrame, type ThreadStreamScrollPortBinding } from "./flow-scroll.measure";
import { pendingRequestBlockNode } from "./pending-request-block";
import { agentRunSummaryNode, statusNode } from "./status";
import { textNode } from "./text";

interface ThreadStreamViewportState {
  blocks: readonly ThreadStreamViewBlock[];
  context: ThreadStreamContext;
  scrollPortBinding: ThreadStreamScrollPortBinding;
}

interface ThreadStreamViewportProps {
  state: ThreadStreamViewportState;
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
}

export function ThreadStreamViewport({ state, rootAttributes }: ThreadStreamViewportProps): UiNode {
  const { blocks, context, scrollPortBinding } = state;
  return (
    <ThreadStreamFlowFrame
      blocks={blocks}
      scrollPortBinding={scrollPortBinding}
      renderBlockContent={(block) => <ThreadStreamBlockContent block={block} context={context} />}
      {...(rootAttributes ? { rootAttributes } : {})}
    />
  );
}

function streamItemNode(item: ThreadStreamRenderedItemView, context: ThreadStreamContext): UiNode {
  if (item.kind === "text") return textNode(item.view, context);
  if (item.kind === "detail") return detailNode(item.view, context);
  return statusNode(item.view);
}

function ThreadStreamBlockContent({ block, context }: { block: ThreadStreamViewBlock; context: ThreadStreamContext }): UiNode {
  return presentationBlockNode(block, context);
}

function presentationBlockNode(block: ThreadStreamViewBlock, context: ThreadStreamContext): UiNode {
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
    return agentRunSummaryNode(block.view, context);
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
      pendingRequests.controlNamespace,
    );
  }
  return streamItemNode(block, context);
}

function pendingRequestContext(context: ThreadStreamContext): PendingRequestBlockContext {
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
  return <div className="codex-panel__stream-item codex-panel__stream-item--system">Send a message to start a conversation.</div>;
}

function ActivityGroup({
  group,
  context,
}: {
  group: Extract<ThreadStreamViewBlock, { kind: "activityGroup" }>;
  context: ThreadStreamContext;
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

function SteeringActivity({ activity }: { activity: Extract<ThreadStreamActivityItemView, { type: "steering" }> }): UiNode {
  return (
    <div className="codex-panel__stream-item codex-panel__stream-item--tool codex-panel__detail-item codex-panel__detail codex-panel__detail--plain">
      <div className="codex-panel__detail-header">
        <span className="codex-panel__stream-item-role codex-panel__detail-label">{activity.label}</span>
      </div>
      <div className="codex-panel__stream-summary">{activity.text}</div>
    </div>
  );
}
