import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import type { PendingRequestBlockSnapshot } from "../../../../../src/features/chat/presentation/pending-requests/view-model";
import { threadStreamViewBlocks } from "../../../../../src/features/chat/presentation/thread-stream/view-model";

describe("thread stream presentation blocks", () => {
  it("keeps the empty state after the history affordance", () => {
    const blocks = threadStreamViewBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: "cursor",
      loadingHistory: false,
      items: [],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["historyBar", "empty"]);
  });

  it("moves active task progress out of the persisted layout into live blocks", () => {
    const blocks = threadStreamViewBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      items: [userDialogue("u1", "turn"), taskProgressItem("task", "turn"), assistantDialogue("a1", "turn")],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "text", "status"]);
    expect(blocks.find((block) => block.key === "live-task:task")).toMatchObject({ kind: "status" });
  });

  it("anchors active agent summaries at the first active agent item", () => {
    const blocks = threadStreamViewBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      items: [userDialogue("u1", "turn"), agentItem("agent", "turn")],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "detail", "liveAgentSummary"]);
    expect(blocks.find((block) => block.kind === "liveAgentSummary")).toMatchObject({ key: "live-agents:turn" });
  });

  it("orders active live blocks by insertion and appends pending requests", () => {
    const blocks = threadStreamViewBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      items: [userDialogue("u1", "turn"), agentItem("agent", "turn"), taskProgressItem("task", "turn")],
      pendingRequests: { signature: "request:1", snapshot: emptyPendingRequestSnapshot() },
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:u1", "item:agent", "live-agents:turn", "live-task:task", "pending-requests"]);
  });

  it("renders unknown item kinds as generic status updates", () => {
    const blocks = threadStreamViewBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "unknown",
          kind: "futureKind",
          role: "tool",
          status: "running",
          output: "raw output",
          operation: "future operation",
        } as unknown as ThreadStreamItem,
      ],
    });

    expect(blocks).toMatchObject([
      {
        kind: "status",
        key: "item:unknown",
        view: {
          kind: "generic",
          label: "futureKind",
          text: "running",
        },
      },
    ]);
  });
});

function userDialogue(id: string, turnId: string): ThreadStreamItem {
  return { id, kind: "dialogue", dialogueKind: "user", role: "user", text: "run", turnId };
}

function assistantDialogue(id: string, turnId: string): ThreadStreamItem {
  return { id, kind: "dialogue", dialogueKind: "assistantResponse", dialogueState: "completed", role: "assistant", text: "done", turnId };
}

function taskProgressItem(id: string, turnId: string): ThreadStreamItem {
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

function agentItem(id: string, turnId: string): ThreadStreamItem {
  return {
    id,
    kind: "agent",
    role: "tool",
    turnId,
    tool: "spawnAgent",
    senderThreadId: "sender",
    receiverThreadIds: ["receiver"],
    agents: [{ threadId: "receiver", status: "running", executionState: "running", message: "Still working" }],
    status: "running",
    prompt: null,
    model: null,
    reasoningEffort: null,
    executionState: "running",
  };
}

function emptyPendingRequestSnapshot(): PendingRequestBlockSnapshot {
  return {
    approvals: [],
    pendingUserInputs: [],
    pendingMcpElicitations: [],
    userInputDrafts: new Map(),
    mcpElicitationDrafts: new Map(),
    approvalDetails: new Set(),
  };
}
