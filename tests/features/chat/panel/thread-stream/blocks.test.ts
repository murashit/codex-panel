import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamViewBlocks } from "../../../../../src/features/chat/panel/thread-stream/blocks";
import type { PendingRequestBlockSnapshot } from "../../../../../src/features/chat/ui/thread-stream/model";

describe("thread stream presentation blocks", () => {
  it("keeps the empty state after the history affordance", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: null,
        historyCursor: "cursor",
        loadingHistory: false,
        items: [],
        workspaceRoot: "/vault",
      }),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["historyBar", "empty"]);
  });

  it("moves active task progress out of the persisted layout into live blocks", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [userDialogue("u1", "turn"), taskProgressItem("task", "turn"), assistantDialogue("a1", "turn")],
        workspaceRoot: "/vault",
      }),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["text", "text", "status"]);
    expect(blocks.find((block) => block.key === "live-task:task")).toMatchObject({ kind: "status" });
  });

  it("anchors active agent summaries at the first active agent item", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [userDialogue("u1", "turn"), agentItem("agent", "turn")],
        workspaceRoot: "/vault",
      }),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["text", "detail", "liveAgentSummary"]);
    expect(blocks.find((block) => block.kind === "liveAgentSummary")).toMatchObject({ key: "live-agents:turn" });
  });

  it("orders active live blocks by insertion and appends pending requests", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [userDialogue("u1", "turn"), agentItem("agent", "turn"), taskProgressItem("task", "turn")],
        workspaceRoot: "/vault",
        pendingRequests: { signature: "request:1", snapshot: emptyPendingRequestSnapshot() },
      }),
    );

    expect(blocks.map((block) => block.key)).toEqual(["item:u1", "item:agent", "live-agents:turn", "live-task:task", "pending-requests"]);
  });

  it("renders unknown item kinds as generic status updates", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: null,
        historyCursor: null,
        loadingHistory: false,
        workspaceRoot: "/vault",
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
      }),
    );

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

function blockInput(
  input: Omit<
    Parameters<typeof threadStreamViewBlocks>[0],
    "stableItems" | "activeItems" | "turnDiffs" | "textActionTargetsByItemId" | "pendingRequests" | "subagentActivities"
  > &
    Partial<
      Pick<
        Parameters<typeof threadStreamViewBlocks>[0],
        "stableItems" | "activeItems" | "turnDiffs" | "textActionTargetsByItemId" | "pendingRequests" | "subagentActivities"
      >
    >,
): Parameters<typeof threadStreamViewBlocks>[0] {
  return {
    ...input,
    stableItems: input.stableItems ?? (input.activeTurnId ? [] : input.items),
    activeItems: input.activeItems ?? (input.activeTurnId ? input.items : []),
    turnDiffs: input.turnDiffs ?? new Map(),
    textActionTargetsByItemId: input.textActionTargetsByItemId ?? new Map(),
    pendingRequests: input.pendingRequests ?? null,
    subagentActivities: input.subagentActivities ?? new Map(),
  };
}

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
