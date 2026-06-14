import { describe, expect, it } from "vitest";

import { messageStreamPresentationBlocks } from "../../../../../src/features/chat/presentation/message-stream/blocks";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";

describe("message stream presentation blocks", () => {
  it("keeps the empty state after the history affordance", () => {
    const blocks = messageStreamPresentationBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: "cursor",
      loadingHistory: false,
      items: [],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["historyBar", "empty"]);
  });

  it("moves active task progress out of the persisted layout into live blocks", () => {
    const blocks = messageStreamPresentationBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      items: [userMessage("u1", "turn"), taskProgressItem("task", "turn"), assistantMessage("a1", "turn")],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["item", "item", "liveTask"]);
    expect(blocks.find((block) => block.kind === "liveTask")).toMatchObject({ key: "live-task:task" });
  });

  it("anchors active agent summaries at the first active agent item", () => {
    const blocks = messageStreamPresentationBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      items: [userMessage("u1", "turn"), agentItem("agent", "turn")],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["item", "item", "liveAgentSummary"]);
    expect(blocks.find((block) => block.kind === "liveAgentSummary")).toMatchObject({ key: "live-agents:turn" });
  });
});

function userMessage(id: string, turnId: string): MessageStreamItem {
  return { id, kind: "message", messageKind: "user", role: "user", text: "run", turnId };
}

function assistantMessage(id: string, turnId: string): MessageStreamItem {
  return { id, kind: "message", messageKind: "assistantResponse", messageState: "completed", role: "assistant", text: "done", turnId };
}

function taskProgressItem(id: string, turnId: string): MessageStreamItem {
  return {
    id,
    kind: "taskProgress",
    role: "tool",
    turnId,
    steps: [{ step: "Work", status: "inProgress" }],
    explanation: "Working",
    status: "running",
    executionState: "running",
  };
}

function agentItem(id: string, turnId: string): MessageStreamItem {
  return {
    id,
    kind: "agent",
    role: "tool",
    turnId,
    tool: "spawnAgent",
    senderThreadId: "sender",
    receiverThreadIds: ["receiver"],
    agents: [{ threadId: "receiver", status: "running", message: "Still working" }],
    status: "running",
    prompt: null,
    model: null,
    reasoningEffort: null,
    executionState: "running",
  };
}
