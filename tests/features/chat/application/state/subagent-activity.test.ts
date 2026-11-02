import { describe, expect, it } from "vitest";
import {
  initialSubagentActivityState,
  reduceSubagentActivitySlice,
} from "../../../../../src/features/chat/application/state/subagent-activity";

describe("subagent activity state", () => {
  it("keeps v2 identity, liveness, and outcome as separate facts", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "started",
    });
    expect(state.byThreadId.get("child")).toMatchObject({ liveness: "running", outcome: null });
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

  it("does not let delayed v2 lifecycle hints overwrite child turn facts", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "turnCompleted",
        threadId: "child",
        turnId: "child-turn",
        completedItems: [],
        outcome: "completed",

        completedTurnTranscriptSummary: null,
      },
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
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: { type: "turnStarted", threadId: "child", turnId: "child-turn" },
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

  it("records a v2 completion as a terminal successful outcome", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "completed",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: "completed",
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
