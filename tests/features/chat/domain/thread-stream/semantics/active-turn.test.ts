import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import { activeTurnLiveItems } from "../../../../../../src/features/chat/domain/thread-stream/semantics/active-turn";

describe("active turn semantics", () => {
  it("summarizes active subagent states while a turn is running", () => {
    expect(
      activeAgentSummary([
        agentItem({
          tool: "wait",
          receiverThreadIds: ["done", "running", "failed"],
          agents: [
            { threadId: "done", status: "completed", executionState: "completed", message: null },
            { threadId: "running", status: "running", executionState: "running", message: null },
            { threadId: "failed", status: "errored", executionState: "failed", message: null },
          ],
        }),
      ]),
    ).toEqual({
      running: 1,
      completed: 1,
      failed: 1,
      agents: [{ threadId: "running", status: "running", messagePreview: null }],
      additionalAgents: 0,
    });
  });

  it("summarizes active subagent previews and fallback receiver states", () => {
    expect(
      activeAgentSummary([
        agentItem({ tool: "spawnAgent", status: "inProgress", receiverThreadIds: ["fallback-child"], agents: [] }),
        agentItem({
          id: "agent-2",
          tool: "wait",
          receiverThreadIds: ["a", "b", "c", "d", "e"],
          agents: [
            { threadId: "a", status: "running", executionState: "running", message: "\n  Inspecting   renderer   tests  \nmore details" },
            { threadId: "b", status: "failed", executionState: "failed", message: "Could not reproduce" },
            { threadId: "c", status: "running", executionState: "running", message: null },
            { threadId: "d", status: "running", executionState: "running", message: "Reviewing details" },
            { threadId: "e", status: "running", executionState: "running", message: "Checking scroll behavior" },
          ],
        }),
      ]),
    ).toMatchObject({
      running: 5,
      completed: 0,
      failed: 1,
      agents: [
        { threadId: "a", status: "running", messagePreview: "Inspecting renderer tests" },
        { threadId: "d", status: "running", messagePreview: "Reviewing details" },
        { threadId: "e", status: "running", messagePreview: "Checking scroll behavior" },
      ],
      additionalAgents: 2,
    });
  });

  it("prefers live activity previews and caps visible rows", () => {
    const items = [
      agentItem({
        receiverThreadIds: ["a", "b", "c", "d"],
        agents: [
          { threadId: "a", status: "running", executionState: "running", message: "Parent fallback" },
          { threadId: "b", status: "running", executionState: "running", message: null },
          { threadId: "c", status: "running", executionState: "running", message: null },
          { threadId: "d", status: "running", executionState: "running", message: null },
        ],
      }),
    ];
    const summary = activeTurnLiveItems(
      {
        items,
        subagentActivities: new Map([
          ["a", { executionState: "running", messagePreview: "Inspecting notification routing" }],
          ["b", { executionState: "running", messagePreview: "Running tests" }],
        ]),
      },
      "t1",
    ).find((item) => item.kind === "agentSummary")?.summary;

    expect(summary).toMatchObject({
      running: 4,
      agents: [
        { threadId: "a", messagePreview: "Inspecting notification routing" },
        { threadId: "b", messagePreview: "Running tests" },
        { threadId: "c", messagePreview: null },
      ],
      additionalAgents: 1,
    });
  });

  it("uses tracked live activity when an in-progress wait item has no receiver state yet", () => {
    const summary = activeTurnLiveItems(
      {
        items: [agentItem({ receiverThreadIds: [], agents: [] })],
        subagentActivities: new Map([["child", { executionState: "running", messagePreview: "Reading repository instructions" }]]),
      },
      "t1",
    ).find((item) => item.kind === "agentSummary")?.summary;

    expect(summary).toMatchObject({
      running: 1,
      agents: [{ threadId: "child", status: "running", messagePreview: "Reading repository instructions" }],
    });
  });

  it("prefers terminal child activity over stale running parent state", () => {
    const items = [
      agentItem({
        receiverThreadIds: ["completed", "failed"],
        agents: [
          { threadId: "completed", status: "running", executionState: "running", message: null },
          { threadId: "failed", status: "running", executionState: "running", message: null },
        ],
      }),
    ];
    const summary = activeTurnLiveItems(
      {
        items,
        subagentActivities: new Map([
          ["completed", { executionState: "completed", messagePreview: "Done" }],
          ["failed", { executionState: "failed", messagePreview: "Interrupted" }],
        ]),
      },
      "t1",
    ).find((item) => item.kind === "agentSummary")?.summary;

    expect(summary).toMatchObject({
      running: 0,
      completed: 1,
      failed: 1,
      agents: [],
    });
  });

  it("prefers a running child activity over a completed spawn item", () => {
    const summary = activeTurnLiveItems(
      {
        items: [
          agentItem({
            tool: "spawnAgent",
            status: "completed",
            executionState: "completed",
            receiverThreadIds: ["child"],
            agents: [],
          }),
        ],
        subagentActivities: new Map([["child", { executionState: "running", messagePreview: "Inspecting files" }]]),
      },
      "t1",
    ).find((item) => item.kind === "agentSummary")?.summary;

    expect(summary).toMatchObject({
      running: 1,
      completed: 0,
      failed: 0,
      agents: [{ threadId: "child", status: "running", messagePreview: "Inspecting files" }],
    });
  });

  it("omits active subagent summaries once every subagent is complete", () => {
    expect(
      activeAgentSummary([
        agentItem({
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["done"],
          agents: [{ threadId: "done", status: "completed", executionState: "completed", message: null }],
        }),
      ]),
    ).toBeNull();
  });
});

function activeAgentSummary(items: readonly ThreadStreamItem[]) {
  return activeTurnLiveItems({ items }, "t1").find((item) => item.kind === "agentSummary")?.summary ?? null;
}

function agentItem(overrides: Partial<Extract<ThreadStreamItem, { kind: "agent" }>>): Extract<ThreadStreamItem, { kind: "agent" }> {
  return {
    id: "agent-1",
    kind: "agent",
    role: "tool",
    text: "Wait for agent",
    turnId: "t1",
    tool: "wait",
    status: "running",
    senderThreadId: "parent",
    receiverThreadIds: [],
    prompt: null,
    model: null,
    reasoningEffort: null,
    agents: [],
    ...overrides,
  };
}
