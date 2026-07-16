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
        { threadId: "c", status: "running", messagePreview: null },
        { threadId: "d", status: "running", messagePreview: "Reviewing details" },
        { threadId: "e", status: "running", messagePreview: "Checking scroll behavior" },
        { threadId: "fallback-child", status: "inProgress", messagePreview: null },
      ],
      additionalAgents: 0,
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
