import { describe, expect, it } from "vitest";
import {
  initialSubagentActivityState,
  reduceSubagentActivitySlice,
} from "../../../../../src/features/chat/application/state/subagent-activity";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("subagent activity state", () => {
  it("keeps v2 identity, liveness, and outcome as separate facts", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "started",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interacted",
    });
    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "running",
      outcome: null,
    });

    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });
    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: null,
    });
  });

  it("tracks a child and accumulates its active reasoning summary", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/tracked",
      threadId: "child",
      parentTurnId: "parent-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-started",
      threadId: "child",
      childTurnId: "child-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "child-turn",
      itemId: "reasoning",
      label: "reasoning",
      delta: "Inspecting ",
      kind: "reasoning",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "child-turn",
      itemId: "reasoning",
      label: "reasoning",
      delta: "routing",
      kind: "reasoning",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "child-turn",
      latestItem: { id: "reasoning", kind: "reasoning", text: "reasoning: Inspecting routing" },
    });
  });

  it("does not let an older item completion replace a newer activity", () => {
    let state = trackedState();
    state = observe(state, reasoningItem("older", "Reading files"), true);
    state = observe(state, reasoningItem("newer", "Running tests"), true);
    state = observe(state, { ...reasoningItem("older", "Finished reading"), executionState: "completed" }, false);

    expect(state.byThreadId.get("child")?.latestItem).toMatchObject({
      id: "newer",
      text: "Running tests",
    });
  });

  it("uses the last displayable canonical item when the child turn completes", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-completed",
      threadId: "child",
      childTurnId: "child-turn",
      items: [
        { id: "user", kind: "dialogue", dialogueKind: "user", role: "user", text: "work" },
        reasoningItem("reasoning", "Done checking"),
        {
          id: "answer",
          kind: "dialogue",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          role: "assistant",
          text: "Everything passes.",
        },
      ],
      outcome: "completed",
    });

    expect(state.byThreadId.get("child")?.latestItem).toMatchObject({
      id: "answer",
      text: "Everything passes.",
    });
  });

  it("ignores delayed notifications from an older child turn", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-started",
      threadId: "child",
      childTurnId: "new-turn",
    });
    state = observe(state, reasoningItem("current", "Current work", "new-turn"), true);
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "old-turn",
      itemId: "stale",
      label: "reasoning",
      delta: "Older work",
      kind: "reasoning",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-completed",
      threadId: "child",
      childTurnId: "old-turn",
      items: [reasoningItem("stale", "Older work", "old-turn")],
      outcome: "completed",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "new-turn",
      liveness: "running",
      outcome: null,
      latestItem: { id: "current", text: "Current work" },
    });
  });

  it("does not let delayed v2 lifecycle hints overwrite child turn facts", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-completed",
      threadId: "child",
      childTurnId: "child-turn",
      items: [],
      outcome: "completed",
    });
    for (const coordinationUpdate of ["started", "interrupted"] as const) {
      state = reduceSubagentActivitySlice(state, {
        type: "subagent-activity/coordination-observed",
        threadId: "child",
        parentTurnId: "parent-turn",
        agentLabel: "/root/scout",
        coordinationUpdate,
      });
    }

    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      childTurnId: "child-turn",
      liveness: "stopped",
      outcome: "completed",
    });
  });

  it("does not revive a v2 agent when started arrives after interrupted", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "started",
    });

    expect(state.byThreadId.get("child")).toMatchObject({ liveness: "stopped", outcome: null });
  });

  it("stops a running child immediately when v2 interruption arrives", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-started",
      threadId: "child",
      childTurnId: "child-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "child-turn",
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: null,
    });
  });
});

function trackedState() {
  return reduceSubagentActivitySlice(initialSubagentActivityState(), {
    type: "subagent-activity/tracked",
    threadId: "child",
    parentTurnId: "parent-turn",
  });
}

function observe(state: ReturnType<typeof trackedState>, item: ThreadStreamItem, advance: boolean): ReturnType<typeof trackedState> {
  return reduceSubagentActivitySlice(state, {
    type: "subagent-activity/item-observed",
    threadId: "child",
    item,
    advance,
  });
}

function reasoningItem(id: string, text: string, turnId = "child-turn"): ThreadStreamItem {
  return { id, kind: "reasoning", role: "tool", turnId, text };
}
