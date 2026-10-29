import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamViewBlocks } from "../../../../../src/features/chat/ui/thread-stream/blocks";
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

  it("keeps historical work grouped while moving active task progress into live blocks", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [
          userDialogue("past-user", "past"),
          { ...taskProgressItem("past-task", "past"), executionState: "completed" },
          assistantDialogue("past-assistant", "past"),
          userDialogue("u1", "turn"),
          taskProgressItem("task", "turn"),
          assistantDialogue("a1", "turn"),
        ],
        workspaceRoot: "/vault",
      }),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["text", "activityGroup", "text", "text", "text", "status"]);
    expect(blocks[1]).toMatchObject({
      kind: "activityGroup",
      turnId: "past",
      items: [{ id: "past-task", kind: "status", view: { kind: "taskProgress", state: "completed" } }],
    });
    expect(blocks.find((block) => block.key === "live-task:task")).toMatchObject({ kind: "status" });
  });

  it("orders active live blocks by insertion and appends pending requests", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [
          userDialogue("past-user", "past"),
          agentItem("past-agent", "past", "past-receiver"),
          assistantDialogue("past-assistant", "past"),
          userDialogue("u1", "turn"),
          agentItem("agent", "turn"),
          taskProgressItem("task", "turn"),
        ],
        workspaceRoot: "/vault",
        pendingRequests: { signature: "request:1", snapshot: emptyPendingRequestSnapshot() },
      }),
    );

    expect(blocks.map((block) => block.key)).toEqual([
      "item:past-user",
      "activity:turn-past-activity",
      "item:past-assistant",
      "item:u1",
      "item:agent",
      "live-agents:turn",
      "live-task:task",
      "pending-requests",
    ]);
    expect(blocks.find((block) => block.kind === "liveAgentSummary")).toMatchObject({ view: { summary: "Agents 1 running" } });
  });

  it("appends transient auth recovery with the active live blocks before requests", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [userDialogue("u1", "turn"), taskProgressItem("task", "turn")],
        workspaceRoot: "/vault",
        authRecovery: {
          message: "Refreshing AWS authentication.",
          phase: "running",
        },
        pendingRequests: { signature: "request:1", snapshot: emptyPendingRequestSnapshot() },
      }),
    );

    expect(blocks.map((block) => block.key)).toEqual(["item:u1", "live-task:task", "live-auth-recovery:turn", "pending-requests"]);
    expect(blocks[2]).toMatchObject({
      kind: "status",
      view: { kind: "generic", label: "auth", state: "running", text: "Refreshing AWS authentication." },
    });
  });

  it("uses the client message id as the stable user-dialogue view key", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: "turn",
        historyCursor: null,
        loadingHistory: false,
        items: [
          {
            id: "server-user",
            clientId: "local-steer",
            kind: "dialogue",
            dialogueKind: "user",
            role: "user",
            text: "run",
            turnId: "turn",
          },
        ],
        workspaceRoot: "/vault",
      }),
    );

    expect(blocks.map((block) => block.key)).toEqual(["item:turn:local-steer"]);
  });

  it("renders completed sleep items as wait status updates", () => {
    const blocks = threadStreamViewBlocks(
      blockInput({
        activeThreadId: "thread",
        activeTurnId: null,
        historyCursor: null,
        loadingHistory: false,
        workspaceRoot: "/vault",
        items: [
          {
            id: "wait",
            kind: "wait",
            role: "tool",
            text: "Waited 2s",
            executionState: "completed",
          },
        ],
      }),
    );

    expect(blocks).toMatchObject([
      {
        kind: "status",
        key: "item:wait",
        view: {
          kind: "generic",
          label: "wait",
          text: "Waited 2s",
          state: "completed",
        },
      },
    ]);
  });
});

function blockInput(
  input: Omit<
    Parameters<typeof threadStreamViewBlocks>[0],
    "turnDiffs" | "textActionTargetsByItemId" | "pendingRequests" | "subagentActivities" | "authRecovery"
  > &
    Partial<
      Pick<
        Parameters<typeof threadStreamViewBlocks>[0],
        "turnDiffs" | "textActionTargetsByItemId" | "pendingRequests" | "subagentActivities" | "authRecovery"
      >
    >,
): Parameters<typeof threadStreamViewBlocks>[0] {
  return {
    ...input,
    turnDiffs: input.turnDiffs ?? new Map(),
    textActionTargetsByItemId: input.textActionTargetsByItemId ?? new Map(),
    pendingRequests: input.pendingRequests ?? null,
    subagentActivities: input.subagentActivities ?? new Map(),
    authRecovery: input.authRecovery ?? null,
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
    executionState: "running",
  };
}

function agentItem(id: string, turnId: string, targetThreadId = "receiver"): ThreadStreamItem {
  return {
    id,
    kind: "agent",
    role: "tool",
    coordinationUpdate: "snapshot",
    turnId,
    action: "spawn",
    senderThreadId: "sender",
    targets: [{ threadId: targetThreadId }],
    agents: [{ threadId: targetThreadId, status: "running", executionState: "running", message: "Still working" }],
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
