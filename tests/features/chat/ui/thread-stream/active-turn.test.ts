import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { activeTurnLiveItems, threadStreamReasoningIsActive } from "../../../../../src/features/chat/ui/thread-stream/active-turn";

describe("active turn presentation", () => {
  it("marks only the latest unfinished active-turn reasoning item as active", () => {
    const firstReasoning: ThreadStreamItem = { id: "r1", kind: "reasoning", role: "tool", text: "first", turnId: "turn" };
    const latestReasoning: ThreadStreamItem = { id: "r2", kind: "reasoning", role: "tool", text: "latest", turnId: "turn" };
    const otherTurnReasoning: ThreadStreamItem = { id: "r3", kind: "reasoning", role: "tool", text: "other", turnId: "other" };

    const context = { activeTurnId: "turn", items: [firstReasoning, latestReasoning, otherTurnReasoning] };

    expect(threadStreamReasoningIsActive(firstReasoning, context)).toBe(false);
    expect(threadStreamReasoningIsActive(latestReasoning, context)).toBe(true);
    expect(threadStreamReasoningIsActive(otherTurnReasoning, context)).toBe(false);
    expect(threadStreamReasoningIsActive({ ...latestReasoning, executionState: "completed" }, context)).toBe(false);
  });
  it("projects v2 paths into the existing summary without treating interaction as a new lifecycle", () => {
    const started = {
      id: "started",
      kind: "agent",
      role: "tool",
      action: "spawn",
      coordinationUpdate: "started",
      status: "started",
      senderThreadId: null,
      targets: [{ threadId: "child", label: "/root/scout" }],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agents: [],
      turnId: "t1",
    } satisfies ThreadStreamItem;
    const interacted: ThreadStreamItem = {
      ...started,
      id: "interacted",
      action: "interact",
      coordinationUpdate: "interacted",
      status: "interacted",
      executionState: null,
    };

    expect(activeAgentSummary([started, interacted])).toMatchObject({
      running: 1,
      failed: 0,
      agents: [{ threadId: "child", agentLabel: "/root/scout", status: "interacted" }],
    });
    expect(
      activeAgentSummary([
        started,
        interacted,
        {
          ...started,
          id: "interrupted",
          action: "interrupt",
          coordinationUpdate: "interrupted",
          status: "interrupted",
          executionState: null,
        },
      ]),
    ).toBeNull();
    expect(
      activeAgentSummary([
        {
          ...started,
          id: "interrupted",
          action: "interrupt",
          coordinationUpdate: "interrupted",
          status: "interrupted",
          executionState: null,
        },
        started,
      ]),
    ).toBeNull();
  });

  it("summarizes active subagent states while a turn is running", () => {
    expect(
      activeAgentSummary([
        agentItem({
          action: "wait",
          targetThreadIds: ["done", "running", "failed"],
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

  it("keeps unknown v1 agent statuses visible as running", () => {
    expect(
      activeAgentSummary([
        agentItem({
          targetThreadIds: ["child"],
          agents: [{ threadId: "child", status: "future-status", executionState: null, message: null }],
        }),
      ]),
    ).toMatchObject({
      running: 1,
      completed: 0,
      failed: 0,
      agents: [{ threadId: "child", status: "future-status" }],
    });
  });

  it("applies lifecycle coordination updates to every normalized target", () => {
    expect(
      activeAgentSummary([
        {
          ...agentItem({}),
          coordinationUpdate: "started",
          status: "started",
          targets: [
            { threadId: "first", label: "/root/first" },
            { threadId: "second", label: "/root/second" },
          ],
        },
      ]),
    ).toMatchObject({
      running: 2,
      agents: [
        { threadId: "first", agentLabel: "/root/first" },
        { threadId: "second", agentLabel: "/root/second" },
      ],
    });
  });

  it("summarizes active subagent previews and fallback receiver states", () => {
    expect(
      activeAgentSummary([
        agentItem({ action: "spawn", status: "inProgress", targetThreadIds: ["fallback-child"], agents: [] }),
        agentItem({
          id: "agent-2",
          action: "wait",
          targetThreadIds: ["a", "b", "c", "d", "e"],
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
        targetThreadIds: ["a", "b", "c", "d"],
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
          ["a", runningActivity("Inspecting notification routing")],
          ["b", runningActivity("Running tests")],
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
        items: [agentItem({ targetThreadIds: [], agents: [] })],
        subagentActivities: new Map([["child", runningActivity("Reading repository instructions")]]),
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
        targetThreadIds: ["completed", "failed"],
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
          ["completed", completedActivity("completed", "Done")],
          ["failed", completedActivity("failed", "Interrupted")],
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
            action: "spawn",
            status: "completed",
            executionState: "completed",
            targetThreadIds: ["child"],
            agents: [],
          }),
        ],
        subagentActivities: new Map([["child", runningActivity("Inspecting files")]]),
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
          action: "wait",
          status: "completed",
          targetThreadIds: ["done"],
          agents: [{ threadId: "done", status: "completed", executionState: "completed", message: null }],
        }),
      ]),
    ).toBeNull();
  });
});

function activeAgentSummary(items: readonly ThreadStreamItem[]) {
  return activeTurnLiveItems({ items }, "t1").find((item) => item.kind === "agentSummary")?.summary ?? null;
}

function runningActivity(messagePreview: string) {
  return { agentLabel: null, liveness: "running" as const, outcome: null, messagePreview };
}

function completedActivity(outcome: "completed" | "failed", messagePreview: string) {
  return { agentLabel: null, liveness: "stopped" as const, outcome, messagePreview };
}

function agentItem(
  overrides: Partial<Extract<ThreadStreamItem, { kind: "agent" }>> & {
    targetThreadIds?: readonly string[];
  },
): Extract<ThreadStreamItem, { kind: "agent" }> {
  const { targetThreadIds, ...itemOverrides } = overrides;
  return {
    id: "agent-1",
    kind: "agent",
    role: "tool",
    text: "Wait for agent",
    turnId: "t1",
    action: "wait",
    coordinationUpdate: "snapshot",
    status: "running",
    senderThreadId: "parent",
    targets: (targetThreadIds ?? []).map((threadId) => ({ threadId })),
    prompt: null,
    model: null,
    reasoningEffort: null,
    agents: [],
    ...itemOverrides,
  };
}
