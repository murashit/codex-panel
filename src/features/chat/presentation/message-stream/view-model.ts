import { messageStreamRenderFamily } from "../../domain/message-stream/semantics";
import type { MessageStreamSemanticClassification } from "../../domain/message-stream/semantics";
import { messageStreamPresentationBlocks, type MessageStreamPresentationBlock, type MessageStreamPresentationBlockInput } from "./blocks";
import type { MessageStreamItemAnnotations, MessageStreamLayoutBlock } from "./layout";
import { messageStreamTextView, type MessageStreamTextView, type TextMessageStreamItem } from "./text-view";
import { toolResultView, type ToolResultMessageStreamItem, type ToolResultView } from "./tool-result-view";
import {
  agentRunSummaryView,
  messageStreamWorkView,
  type AgentRunSummaryView,
  type MessageStreamWorkView,
  type WorkMessageStreamItem,
} from "./work-view";

export type MessageStreamRenderedItemView =
  | {
      kind: "text";
      view: MessageStreamTextView;
    }
  | {
      kind: "toolResult";
      view: ToolResultView;
    }
  | {
      kind: "work";
      view: MessageStreamWorkView;
    };

export type MessageStreamActivityItemView =
  | ({
      type: "item";
      id: string;
    } & MessageStreamRenderedItemView)
  | {
      type: "steering";
      id: string;
      label: string;
      text: string;
      sourceItemId: string;
    };

export type MessageStreamViewBlock =
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
    } & MessageStreamRenderedItemView)
  | {
      kind: "activityGroup";
      key: string;
      id: string;
      turnId: string;
      summary: string;
      items: MessageStreamActivityItemView[];
    }
  | {
      kind: "liveAgentSummary";
      key: string;
      view: AgentRunSummaryView;
    };

export function messageStreamViewBlocks(input: MessageStreamPresentationBlockInput): MessageStreamViewBlock[] {
  return messageStreamPresentationBlocks(input).map((block) => messageStreamViewBlockFromPresentationBlock(block, input));
}

export function messageStreamViewHasEmptyBlock(blocks: readonly MessageStreamViewBlock[]): boolean {
  return blocks.some((block) => block.kind === "empty");
}

function messageStreamViewBlockFromPresentationBlock(
  block: MessageStreamPresentationBlock,
  input: MessageStreamPresentationBlockInput,
): MessageStreamViewBlock {
  if (block.kind === "historyBar" || block.kind === "empty") return block;
  if (block.kind === "liveAgentSummary") return { kind: "liveAgentSummary", key: block.key, view: agentRunSummaryView(block.summary) };
  if (block.kind === "liveTask") {
    return { kind: "work", key: block.key, view: messageStreamWorkView(block.item, workViewContext(input)) };
  }
  if (block.kind === "activityGroup") {
    return {
      kind: "activityGroup",
      key: block.key,
      id: block.block.id,
      turnId: block.block.turnId,
      summary: block.block.summary,
      items: block.block.items.map((activity) => messageStreamActivityItemView(activity, input)),
    };
  }
  return { key: block.key, ...messageStreamRenderedItemView(block.block.classification, input, block.block.annotations) };
}

function messageStreamActivityItemView(
  activity: Extract<MessageStreamLayoutBlock, { type: "activityGroup" }>["items"][number],
  input: MessageStreamPresentationBlockInput,
): MessageStreamActivityItemView {
  if (activity.type === "steering") return activity;
  return { type: "item", id: activity.id, ...messageStreamRenderedItemView(activity.classification, input) };
}

function messageStreamRenderedItemView(
  classification: MessageStreamSemanticClassification,
  input: MessageStreamPresentationBlockInput,
  annotations?: MessageStreamItemAnnotations,
): MessageStreamRenderedItemView {
  const renderFamily = messageStreamRenderFamily(classification);
  if (renderFamily === "text") return { kind: "text", view: messageStreamTextView(textItemFromSemantic(classification), annotations) };
  if (renderFamily === "toolResult") {
    return { kind: "toolResult", view: toolResultView(toolResultItemFromSemantic(classification), input.workspaceRoot) };
  }
  if (renderFamily === "work")
    return { kind: "work", view: messageStreamWorkView(workItemFromSemantic(classification), workViewContext(input)) };
  return unhandledClassification(classification);
}

function workViewContext(input: MessageStreamPresentationBlockInput): Parameters<typeof messageStreamWorkView>[1] {
  return {
    activeTurnId: input.activeTurnId,
    items: input.items,
    activeItems: input.activeItems,
  };
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
