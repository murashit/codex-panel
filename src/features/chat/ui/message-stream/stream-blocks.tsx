import { Fragment, type ComponentChild as UiNode } from "preact";

import { activeTurnId } from "../../state/reducer";
import {
  messageStreamPresentationBlocks,
  messageStreamPresentationHasEmptyBlock,
  type MessageStreamPresentationBlock,
} from "../../message-stream/presentation/blocks";
import type { MessageStreamItemAnnotations, MessageStreamLayoutBlock } from "../../message-stream/presentation/layout";
import { messageStreamRenderFamily, type MessageStreamSemanticClassification } from "../../message-stream/semantics";
import { pendingRequestBlockNode } from "./pending-request-block";
import { toolResultNode } from "./tool-result";
import type { ToolResultMessageStreamItem } from "./tool-result-view-model";
import { agentRunSummaryNode, workItemNode, type WorkMessageStreamItem } from "./work-items";
import type { MessageStreamBlock, MessageStreamContext, TextMessageStreamItem } from "./context";
import { textItemNode } from "./text-item";

function messageStreamActiveTurnId(context: Pick<MessageStreamContext, "turnLifecycle">): string | null {
  return activeTurnId({ lifecycle: context.turnLifecycle });
}

function streamItemNode(
  classification: MessageStreamSemanticClassification,
  context: MessageStreamContext,
  annotations?: MessageStreamItemAnnotations,
): UiNode {
  const renderFamily = messageStreamRenderFamily(classification);
  if (renderFamily === "text") return textItemNode(textItemFromSemantic(classification), context, annotations);
  if (renderFamily === "toolResult") return toolResultNode(toolResultItemFromSemantic(classification), context);
  if (renderFamily === "work") return workItemNode(workItemFromSemantic(classification), context);
  return unhandledClassification(classification);
}

export function messageStreamBlocks(context: MessageStreamContext): MessageStreamBlock[] {
  const activeTurn = messageStreamActiveTurnId(context);
  const presentationBlocks = messageStreamPresentationBlocks({
    activeThreadId: context.activeThreadId,
    activeTurnId: activeTurn,
    historyCursor: context.historyCursor,
    loadingHistory: context.loadingHistory,
    items: context.items,
    stableItems: context.stableItems,
    activeItems: context.activeItems,
    workspaceRoot: context.workspaceRoot,
    turnDiffs: context.turnDiffs,
  });
  const blocks = presentationBlocks.map((block) => presentationBlockNode(block, context));

  if (!messageStreamPresentationHasEmptyBlock(presentationBlocks) && context.pendingRequests?.signature) {
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

function presentationBlockNode(block: MessageStreamPresentationBlock, context: MessageStreamContext): MessageStreamBlock {
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
  if (block.kind === "item") {
    return {
      key: block.key,
      node: streamItemNode(block.block.classification, context, block.block.annotations),
    };
  }
  if (block.kind === "activityGroup") {
    return {
      key: block.key,
      node: <ActivityGroup group={block.block} context={context} />,
    };
  }
  if (block.kind === "liveTask") {
    return {
      key: block.key,
      node: workItemNode(block.item, context),
    };
  }
  return {
    key: block.key,
    node: agentRunSummaryNode(block.summary),
  };
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

function textItemFromSemantic({ item }: MessageStreamSemanticClassification): TextMessageStreamItem {
  if (item.kind === "message" || item.kind === "system" || item.kind === "userInputResult") return item;
  throw new Error(`Message stream semantic expected text item: ${JSON.stringify(item)}`);
}

function toolResultItemFromSemantic({ item }: MessageStreamSemanticClassification): ToolResultMessageStreamItem {
  if (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "goal" ||
    item.kind === "tool" ||
    item.kind === "hook" ||
    item.kind === "approvalResult" ||
    item.kind === "reviewResult"
  ) {
    return item;
  }
  throw new Error(`Message stream semantic expected tool result item: ${JSON.stringify(item)}`);
}

function workItemFromSemantic({ item }: MessageStreamSemanticClassification): WorkMessageStreamItem {
  if (item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction") return item;
  throw new Error(`Message stream semantic expected work item: ${JSON.stringify(item)}`);
}

function unhandledClassification(classification: MessageStreamSemanticClassification): never {
  throw new Error(`Unhandled message stream classification: ${JSON.stringify(classification)}`);
}

function ActivityGroup({
  group,
  context,
}: {
  group: Extract<MessageStreamLayoutBlock, { type: "activityGroup" }>;
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
          {activity.type === "steering" ? <SteeringActivity activity={activity} /> : streamItemNode(activity.classification, context)}
        </Fragment>
      ))}
    </details>
  );
}

function SteeringActivity({
  activity,
}: {
  activity: Extract<Extract<MessageStreamLayoutBlock, { type: "activityGroup" }>["items"][number], { type: "steering" }>;
}): UiNode {
  return (
    <div className="codex-panel__message codex-panel__message--tool codex-panel__tool-item codex-panel__tool-result codex-panel__tool-result--plain">
      <div className="codex-panel__tool-result-header">
        <span className="codex-panel__message-role codex-panel__tool-result-label">{activity.label}</span>
      </div>
      <div className="codex-panel__tool-summary">{activity.text}</div>
    </div>
  );
}
